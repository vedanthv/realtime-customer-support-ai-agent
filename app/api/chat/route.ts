import { NextRequest } from "next/server";
import { vectorSearch } from "@/lib/databricks";
import { callLLM } from "@/lib/llm";
import { endMlflowRun, logMlflowMetrics, logMlflowParams, logMlflowTags, startMlflowRun } from "@/lib/mlflow";
import OpenAI from "openai";
import redis from "@/lib/redis"; 
import fs from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = "nodejs";

const CLASSIFIER_MODEL = "gpt-4o-mini";
const SUMMARY_MODEL = "gpt-4o-mini";
const FOLLOWUPS_MODEL = "gpt-4o-mini";
const RAG_RESPONSE_MODEL = "gpt-4o-mini";

type QueryContext = Record<string, Array<string | number>>;

// ================= SQL HELPERS =================

function cleanSQL(sql: string) {
  let cleaned = sql
    .replace(/```sql/g, "")
    .replace(/```/g, "")
    .replace(/^sql\s*/i, "")
    .trim();

  cleaned = cleaned.replace(
    /customer_support_agent\.raw\.orders/gi,
    "customer_suppport_agent.raw.orders"
  );

  return cleaned;
}

const today = new Date().toISOString().split("T")[0];

let cachedPrompt: string | null = null;

function getPromptTemplate(): string {
  if (!cachedPrompt) {
    const filePath = path.join(process.cwd(), "prompts", "sql_rag_classifier.txt");
    cachedPrompt = fs.readFileSync(filePath, "utf-8");
  }
  return cachedPrompt;
}

let lastQueryContext: QueryContext | null = null;

function summarizeContext(rows: Array<Record<string, unknown>>): QueryContext | null {
  if (!rows || rows.length === 0) return null;

  const sample = rows.slice(0, 5); // limit size
  const keys = Object.keys(sample[0]);

  const idFields = keys.filter((k) =>
    k.toLowerCase().includes("id")
  );

  const summary: QueryContext = {};

  for (const field of idFields) {
    summary[field] = sample
      .map((r) => r[field])
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number");
  }

  return summary;
}

function formatContextForPrompt(context: QueryContext | null) {
  if (!context) return "";

  let text = "\nPrevious query result context:\n";

  for (const key of Object.keys(context)) {
    const values = context[key]
      .map((v: any) => `'${v}'`)
      .join(", ");

    text += `${key}: ${values}\n`;
  }

  return text;
}

function shouldForceSqlFollowUp(question: string, context: QueryContext | null) {
  if (!context) return false;

  const q = question.toLowerCase();
  const hasFollowUpReference = /\b(this|that|these|those|it|them|same)\b/.test(q);
  const hasShippingIntent = /\bshipping|delivery|instruction|address|fulfillment|dispatch\b/.test(q);
  const hasOrderIntent = /\border\b/.test(q);
  const hasOrderContext = Object.keys(context).some(
    (key) => key.toLowerCase() === "order_id" || key.toLowerCase().includes("order")
  );

  return hasOrderContext && (hasShippingIntent || (hasOrderIntent && hasFollowUpReference));
}

function shouldForceSqlAnalytics(question: string) {
  const q = question.toLowerCase();

  const hasDomainIntent = /\border|orders|revenue|sales|customer|customers|payment|payments|delivery|shipments?\b/.test(q);
  const hasTimeSeriesIntent = /\btrend|trends|over time|timeline|month over month|week over week|year over year|monthly|weekly|daily|quarterly|yearly|by month|by week|by day|by quarter|by year\b/.test(q);
  const hasAnalyticVerb = /\banaly[sz]e|analysis|show|summari[sz]e|breakdown|compare|group|distribute\b/.test(q);
  const hasBroadStructuredIntent = /\banalytics?|summary|overview|breakdown|metrics?|kpis?|stats?|statistics|totals?\b/.test(q);
  const hasWholeDatasetScope = /\ball\b|\boverall\b|\bwhole\b|\bentire\b|\bfull\b|\bacross the db\b|\bacross the database\b/.test(q);
  
  // Demographic/segmentation queries
  const hasDemographicIntent = /\bdemographic|segmentation?|segment|cohort|categorical|distribution|profiling?\b/.test(q);

  return hasDomainIntent && (
    (hasTimeSeriesIntent && hasAnalyticVerb) ||
    (hasBroadStructuredIntent && hasWholeDatasetScope) ||
    (hasDemographicIntent && hasAnalyticVerb)
  );
}

async function getSessionContext(sessionId?: string): Promise<QueryContext | null> {
  if (!sessionId) return null;

  try {
    const raw = await redis.get(`chat_ctx:${sessionId}`);
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as QueryContext) : null;
  } catch {
    return null;
  }
}

async function saveSessionContext(sessionId: string, context: QueryContext | null) {
  if (!context) return;

  const ctxKey = `chat_ctx:${sessionId}`;
  await redis
    .pipeline()
    .set(ctxKey, JSON.stringify(context))
    .expire(ctxKey, 3600)
    .exec();
}

async function generateSQL(question: string, history: any[] = []) {
  const historyText = history
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const template = getPromptTemplate();

  const contextText = formatContextForPrompt(lastQueryContext);

  const prompt = template
  .replace(/{{history}}/g, historyText + contextText)
  .replace(/{{today}}/g, today)
  .replace(/{{question}}/g, question);

  console.log(prompt.substring(0, 500));
  const res = await openai.chat.completions.create({
    model: CLASSIFIER_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  
  const rawContent = res.choices[0].message.content!;
  
  // Parse JSON response
  try {
    const parsed = JSON.parse(rawContent);
    return parsed;
  } catch (e) {
    console.error("Failed to parse classifier JSON:", rawContent);
    // Fallback: treat as RAG if JSON parsing fails
    return { route: "RAG", confidence: 0.5, reasoning: "Parser error", sql: null };
  }
}

async function runSQL(query: string) {
  console.log("Running SQL:", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(process.env.DATABRICKS_SQL_URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DATABRICKS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        statement: query,
        warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
        wait_timeout: "20s",
      }),
      signal: controller.signal,
    });

    const data = await res.json();

    const columns = data?.manifest?.schema?.columns || [];
    const rows = data?.result?.data_array || [];

    return rows.map((row: any[]) => {
      const obj: any = {};
      columns.forEach((col: any, i: number) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function appendHistory(key: string, role: "user" | "assistant", content: string) {
  await redis
    .pipeline()
    .rpush(key, JSON.stringify({ role, content }))
    .ltrim(key, -20, -1)
    .expire(key, 3600)
    .exec();
}

// ================= FOLLOW UPS =================

async function generateFollowUps(question: string, answer: string) {
  const prompt = `
Generate 3 short follow-up responses.

Rules:
- Max 10 words
- No numbering
- No symbols

Dont give questions please. Give some suggestions for additional insights that are useful for the user. 

Question: ${question}
Answer: ${answer}
`;

  const res = await openai.chat.completions.create({
    model: FOLLOWUPS_MODEL,
    messages: [{ role: "user", content: prompt }],
  });

  return (
    res.choices[0].message.content
      ?.split("\n")
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 3) || []
  );
}

// ================= MAIN =================

export async function POST(req: NextRequest) {
  const t0 = performance.now();
  const { question, history, sessionId } = await req.json();
  const requestId = crypto.randomUUID();

  const mlflowRunId = await startMlflowRun({
    endpoint: "api_chat",
    request_id: requestId,
    session_id: String(sessionId ?? "unknown"),
  });

  await logMlflowTags(mlflowRunId, {
    "genai.app": "orders-ai-agent",
    "genai.use_case": "customer_support_analytics",
    "genai.provider": "openai",
    "genai.pipeline": "classifier_sql_rag_hybrid",
  });

  await logMlflowParams(mlflowRunId, {
    question_len: String((question ?? "").length),
    has_history: String(Boolean(history?.length)),
    has_session: String(Boolean(sessionId)),
    model_classifier: CLASSIFIER_MODEL,
    model_summary: SUMMARY_MODEL,
    model_followups: FOLLOWUPS_MODEL,
    model_rag_response: RAG_RESPONSE_MODEL,
  });

  const timings: Record<string, number> = {};

  const key = `chat:${sessionId}`;
  const sessionContext = await getSessionContext(sessionId);
  if (sessionContext) {
    lastQueryContext = sessionContext;
  }

  let redisHistory: any[] = [];

  if (sessionId) {
    try {
      const stored = await redis.lrange(key, 0, -1);
      redisHistory = (stored || []).map((m: string) => JSON.parse(m));
    } catch {
      redisHistory = [];
    }
  }

  const finalHistory = redisHistory.length
    ? redisHistory.slice(-6)
    : history || [];

  if (sessionId) {
    await appendHistory(key, "user", question);
  }

  // Step 1: Get classifier decision with confidence score
  const tClassify0 = performance.now();
  const classificationResult = await generateSQL(question, finalHistory);
  timings.classify_ms = Math.round(performance.now() - tClassify0);

  // Parse the response
  const {
    route: classifiedRoute = "RAG",
    confidence = 0.5,
    reasoning = "Unknown",
    sql: classifiedSQL = null
  } = classificationResult;

  console.log(`Classification: ${classifiedRoute} (confidence: ${confidence}), reasoning: ${reasoning}`);

  // Step 2: Make routing decision based on confidence
  // High confidence (>= 0.85) → trust the classifier
  // Low confidence (< 0.85) → use safety net or default to RAG
  let useSQL = false;
  let forcedSql = false;
  let sqlOrRag = "";
  let finalDecisionReason = reasoning;

  if (confidence >= 0.85) {
    // Trust high-confidence classification
    useSQL = classifiedRoute === "SQL";
    forcedSql = false;
    sqlOrRag = classifiedSQL || "RAG";
  } else if (confidence >= 0.70 && classifiedRoute === "SQL") {
    // Medium confidence SQL → try it, but be prepared to fallback
    useSQL = true;
    forcedSql = false;
    sqlOrRag = classifiedSQL || "RAG";
  } else {
    // Low confidence → default to RAG (safe fallback)
    useSQL = false;
    forcedSql = false;
    sqlOrRag = "RAG";
    finalDecisionReason = `Low confidence (${confidence.toFixed(2)}). Defaulting to RAG. ${reasoning}`;
  }

  const decisionReason = useSQL ? finalDecisionReason : finalDecisionReason;

  console.log("ROUTE:", useSQL ? "SQL" : "RAG");

  // ================= SQL ROUTE =================
  if (useSQL) {
    try {
      const sql = cleanSQL(classifiedSQL || "");
      await logMlflowParams(mlflowRunId, {
        route_mode: "SQL",
        forced_sql: String(forcedSql),
        classifier_confidence: String(confidence.toFixed(2)),
      });

      const tSqlExec0 = performance.now();
      const result = await runSQL(sql);
      timings.sql_exec_ms = Math.round(performance.now() - tSqlExec0);
      console.log(result);
      lastQueryContext = summarizeContext(result);
      if (sessionId) {
        await saveSessionContext(sessionId, lastQueryContext);
      }
      if (!result || result.length === 0) {
        const tRetrieval0 = performance.now();
        const { context } = await vectorSearch(question);
        timings.retrieval_ms = Math.round(performance.now() - tRetrieval0);

        const tRagLlm0 = performance.now();
        const ragAnswer = await callLLM([
          {
            role: "system",
            content:
              "Tell user that a full query failed, then answer using context.",
          },
          {
            role: "user",
            content: `Q: ${question}\n\nContext:\n${context}`,
          },
        ]);
        timings.rag_llm_ms = Math.round(performance.now() - tRagLlm0);
        timings.total_ms = Math.round(performance.now() - t0);

        await logMlflowMetrics(mlflowRunId, {
          ...timings,
          route_sql: 1,
          fallback_to_rag: 1,
          sql_rows: 0,
        });
        await endMlflowRun(mlflowRunId, "FINISHED");

        return new Response(
          JSON.stringify({
            answer: ragAnswer,
            table: [],
            followUps: [],
            mode: "RAG",
            reason: "SQL returned no rows; switched to retrieval context.",
            classifier_confidence: parseFloat(confidence.toFixed(2)),
            context: lastQueryContext,
            requestId,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      const tSummary0 = performance.now();
      const summaryRes = await openai.chat.completions.create({
        model: SUMMARY_MODEL,
        messages: [
          {
            role: "user",
            content: `Question: ${question}\nData: ${JSON.stringify(result)}`,
          },
        ],
      });
      timings.summary_llm_ms = Math.round(performance.now() - tSummary0);

      const summary =
        summaryRes.choices[0].message.content ||
        "No meaningful data found";

      const followUps = await generateFollowUps(question, summary).catch(() => []);

      if (sessionId) {
        await appendHistory(key, "assistant", summary);
      }

      timings.total_ms = Math.round(performance.now() - t0);

      // Limit displayed rows to 10, but track total available
      const totalRows = result.length;
      const displayedRows = Math.min(10, result.length);
      const tableDisplay = result.slice(0, 10);
      const hasMoreRows = totalRows > 10;

      await logMlflowMetrics(mlflowRunId, {
        ...timings,
        route_sql: 1,
        fallback_to_rag: 0,
        sql_rows: result.length,
      });
      await endMlflowRun(mlflowRunId, "FINISHED");

      console.info("[chat][SQL] total_ms", Math.round(performance.now() - t0));

      return new Response(
        JSON.stringify({
          answer: summary,
          table: tableDisplay,
          totalRows,
          displayedRows,
          hasMoreRows,
          followUps,
          mode: "SQL",
          reason: decisionReason,
          classifier_confidence: parseFloat(confidence.toFixed(2)),
          context: lastQueryContext,
          requestId,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      timings.total_ms = Math.round(performance.now() - t0);
      await logMlflowMetrics(mlflowRunId, {
        ...timings,
        route_sql: 1,
        failed: 1,
      });
      await endMlflowRun(mlflowRunId, "FAILED");

      return new Response(
        JSON.stringify({ message: e.message }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ================= RAG ROUTE =================

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await logMlflowParams(mlflowRunId, {
          route_mode: "RAG",
          forced_sql: String(forcedSql),
        });

        const tRetrieval0 = performance.now();
        const { context } = await vectorSearch(question);
        timings.retrieval_ms = Math.round(performance.now() - tRetrieval0);

        const tRagLlm0 = performance.now();
        const rawAnswer = await callLLM([
          {
            role: "system",
            content: `You are a helpful assistant.`,
          },
          ...finalHistory.map((msg: any) => ({
            role: msg.role,
            content: msg.content,
          })),
          {
            role: "user",
            content: `Q: ${question}${formatContextForPrompt(lastQueryContext)}\n\nContext:\n${context}`,
          },
        ]);
        timings.rag_llm_ms = Math.round(performance.now() - tRagLlm0);

        const followUpsPromise = generateFollowUps(question, rawAnswer).catch(() => []);

        let fullText = "";

        const chunkSize = 64;
        for (let i = 0; i < rawAnswer.length; i += chunkSize) {
          const chunk = rawAnswer.slice(i, i + chunkSize);
          fullText += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        if (sessionId) {
          await appendHistory(key, "assistant", fullText);
        }

        const followUps = await followUpsPromise;

        controller.enqueue(
          encoder.encode("\n__FOLLOWUPS__" + JSON.stringify(followUps))
        );
        controller.enqueue(
          encoder.encode("\n__META__" + JSON.stringify({
            mode: "RAG",
            reason: decisionReason,
            classifier_confidence: parseFloat(confidence.toFixed(2)),
            context: lastQueryContext,
            requestId,
          }))
        );

        controller.close();
        timings.total_ms = Math.round(performance.now() - t0);
        await logMlflowMetrics(mlflowRunId, {
          ...timings,
          route_sql: 0,
          fallback_to_rag: 0,
          answer_chars: rawAnswer.length,
        });
        await endMlflowRun(mlflowRunId, "FINISHED");
        console.info("[chat][RAG] total_ms", Math.round(performance.now() - t0));
      } catch (e: any) {
        controller.enqueue(encoder.encode("Error: " + e.message));
        controller.close();
        timings.total_ms = Math.round(performance.now() - t0);
        await logMlflowMetrics(mlflowRunId, {
          ...timings,
          route_sql: 0,
          failed: 1,
        });
        await endMlflowRun(mlflowRunId, "FAILED");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}