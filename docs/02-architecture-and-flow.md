# Architecture And Flow

## High-Level Architecture

Orders AI Agent uses a classifier-routed hybrid architecture:

1. A user question arrives via web chat.
2. The classifier predicts SQL or RAG with confidence.
3. Deterministic guardrails adjust route selection.
4. SQL branch executes warehouse query and summarizes rows.
5. RAG branch performs vector retrieval and composes response.
6. Response returns to UI as either JSON (SQL) or stream (RAG).
7. Session context and telemetry are updated.

## Runtime Components

### UI Layer

- app/page.tsx
- components/chat.tsx
- components/message.tsx
- components/sidebar.tsx

Responsibilities:

- Collect user input.
- Render conversation and tables.
- Persist local chat history.
- Parse streaming response envelope.
- Submit message-level feedback.

### API Layer

- app/api/chat/route.ts
- app/api/feedback/route.ts
- app/api/generate-title/route.ts

Responsibilities:

- Route selection and request orchestration.
- Data retrieval and LLM summarization.
- Feedback persistence.
- Metadata enrichment.

### Integration Layer

- lib/databricks.ts
- lib/llm.ts
- lib/redis.ts
- lib/mlflow.ts

Responsibilities:

- External API calls and credentials usage.
- Result normalization.
- Context caching.
- Telemetry forwarding.

## Chat Route Deep Dive

Main orchestration occurs in app/api/chat/route.ts.

### Inputs

- question
- history
- sessionId

### Preprocessing Steps

1. Create requestId for traceability.
2. Start MLflow run and attach tags/params.
3. Load session context from Redis key chat_ctx:{sessionId}.
4. Load recent stored message history from Redis key chat:{sessionId}.
5. Append incoming user message to Redis history.

### Classification Pipeline

1. Load template from prompts/sql_rag_classifier.txt once and cache in memory.
2. Inject dynamic values:
   - history
   - today
   - question
   - prior query context summary
3. Ask OpenAI model for JSON output containing:
   - route
   - confidence
   - reasoning
   - sql
4. Parse JSON; fallback to safe RAG object if parsing fails.

### Route Decision Logic

The route logic uses confidence thresholds:

- confidence >= 0.85
  - trust classifier route.
- 0.70 <= confidence < 0.85 and classifier says SQL
  - execute SQL with safety fallback behavior.
- confidence < 0.70
  - force RAG safe mode.

Supporting helpers:

- shouldForceSqlAnalytics identifies analytic intent signatures including demographic patterns.
- shouldForceSqlFollowUp identifies contextual references tied to prior SQL entities.

Note: these helpers are present and available for rule logic and future hard-routing expansion.

## SQL Branch

### Steps

1. Clean generated SQL:
   - Strip markdown fences.
   - Normalize schema typo variants to deployed schema name.
2. Execute SQL through Databricks Statement API.
3. Convert manifest and row arrays into JSON row objects.
4. Extract id-like fields into compact query context summary.
5. Save context to Redis for follow-ups.
6. Summarize result rows with OpenAI.
7. Generate follow-up suggestions.
8. Return JSON payload with answer, table preview, metadata.

### SQL Fallback Behavior

If SQL executes successfully but returns zero rows:

1. Perform vector retrieval for the original question.
2. Synthesize response from retrieval context.
3. Return as JSON with mode RAG and reason stating SQL returned no rows.

## RAG Branch

### Retrieval

lib/databricks.ts vectorSearch:

1. Build query embedding via text-embedding-3-large.
2. Query both indexes in parallel with HYBRID search mode.
3. Normalize per-index score ranges.
4. Deduplicate by text body.
5. Sort globally and keep top K.
6. Build numbered context string for generation.

### Generation

1. Build LLM message stack using:
   - system instruction
   - final conversation history slice
   - user prompt with injected prior context and retrieved context
2. Generate complete answer string.
3. Stream answer to client in fixed-size chunks.
4. Append two envelope sections:
   - __FOLLOWUPS__ with JSON array
   - __META__ with mode, reason, confidence, context, requestId

## Session And State Model

### Redis Keys

- chat:{sessionId}
  - list of serialized user and assistant messages.
  - trimmed to latest 20 entries.
  - 1-hour expiry.
- chat_ctx:{sessionId}
  - JSON object storing extracted id-field context.
  - 1-hour expiry.

### Client Local Storage

- session_id
  - generated once and reused unless reset.
- chat_history
  - list of local chat threads used by sidebar.

## Observability Model

Each chat request attempts to log:

- Tags
  - application and pipeline identity.
- Params
  - model names, question length, routing metadata.
- Metrics
  - latency stages, route outcomes, answer size, fallback flags.
- Status
  - FINISHED or FAILED.

MLflow writes are best-effort and non-fatal.

## Failure Paths

1. Classifier JSON parse failure
   - falls back to RAG route object.
2. SQL branch errors
   - returns JSON error response.
3. RAG branch errors
   - streams error text and closes stream.
4. MLflow failures
   - logged as warnings and execution proceeds.

## Architectural Strengths

- Hybrid strategy balances precision and coverage.
- Defensive confidence thresholds reduce incorrect SQL attempts.
- Fallback from empty SQL results improves answer continuity.
- Session context supports multi-turn analytical threads.

## Current Architectural Gaps

- Ingest endpoints are placeholders.
- No authentication/authorization middleware.
- Shared in-memory lastQueryContext could be ambiguous under high concurrency.
- Prompt file contains legacy duplicated blocks and can be streamlined.
