# Project Overview

## Purpose

Orders AI Agent is a conversational analytics system for e-commerce support and operations teams. It translates natural-language questions into one of two execution strategies:

- SQL analytics on structured warehouse data.
- RAG-based synthesis from vector-retrieved context.

The objective is to provide fast, reliable, and explainable responses while collecting quality signals for continuous system improvement.

## What The Product Solves

Typical analytics workflows require users to know SQL, schema design, and dashboard structure. This project reduces that friction by allowing users to ask questions directly and get:

- Narrative answers.
- Structured result tables for quantitative prompts.
- Follow-up suggestions to deepen analysis.
- Session continuity for contextual follow-up prompts.

## Core Capabilities

1. Hybrid route selection via classifier output and deterministic safety logic.
2. Databricks SQL execution for aggregations, ranking, filtering, and trend analysis.
3. Databricks vector retrieval across multiple indices for semantic context.
4. Summarization with OpenAI responses for both SQL and RAG flows.
5. Session context memory in Redis for continuity.
6. Feedback collection for supervised quality analysis.
7. MLflow instrumentation for latency and quality observability.

## Runtime Topology

Application runtime is split into these layers:

- Web Client Layer
  - app/page.tsx and components manage chat state, history, rendering, and user interactions.
- API Layer
  - app/api/chat/route.ts orchestrates routing, SQL/RAG execution, and response shaping.
  - app/api/feedback/route.ts persists thumbs feedback.
  - app/api/generate-title/route.ts creates concise chat titles.
- Integration Layer
  - lib/databricks.ts handles SQL, vector search, embeddings, and feedback insert.
  - lib/llm.ts wraps OpenAI chat completions.
  - lib/redis.ts handles session persistence.
  - lib/mlflow.ts handles telemetry writes.

## Functional Domains

### Conversational Analytics

The assistant supports broad analytics prompts such as:

- Distribution and demographic breakdowns.
- Time-series trend questions.
- Summaries and KPI-like overviews.
- Follow-up drill-down based on prior context.

### Retrieval-Assisted Responses

When the system deems a prompt ambiguous, unstructured, narrative-heavy, or low-confidence for SQL, it retrieves context from vector indexes and synthesizes a direct answer.

### Quality Loop

Every request can be observed and improved using:

- MLflow run metrics.
- User feedback signals.
- Route and confidence metadata.

## Intended Users

- Customer support managers looking for order-level insights.
- Operations analysts who need fast exploratory analytics.
- Product and data teams monitoring interaction quality and routing outcomes.

## System Boundaries

Included:

- Interactive chat UI.
- API-based route orchestration.
- Databricks SQL and vector integrations.
- Session and feedback tracking.

Not included yet:

- Fully implemented ingestion API handlers under app/api/ingest.
- Long-term server-side chat persistence.
- Authentication and role-based access control.

## Important Conventions

1. Schema naming intentionally uses customer_suppport_agent with triple p to match deployed assets.
2. Route confidence thresholds are built into chat API logic.
3. RAG responses are streamed using a custom envelope format that appends follow-ups and metadata.
4. SQL responses are returned as JSON and include a table preview.

## Reading Sequence For New Contributors

1. README.md for fast setup and architecture index.
2. docs/02-architecture-and-flow.md for execution logic.
3. docs/03-api-reference.md for endpoint-level contracts.
4. docs/04-frontend-and-state.md for UI and persistence behavior.
5. docs/05-operations-and-deployment.md for env, deployment, and troubleshooting.
