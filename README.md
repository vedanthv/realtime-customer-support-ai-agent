# Orders AI Agent

A full-stack analytics assistant for e-commerce support teams, built on Next.js. The app accepts natural-language questions and dynamically routes each request to either:

- SQL mode for structured analytics and aggregations from Databricks tables.
- RAG mode for semantic, context-driven answers from Databricks vector search.

The system also captures user feedback, tracks request-level telemetry in MLflow, and preserves conversational context in Redis to make follow-up questions more useful.

## Table Of Contents

- Project Goals
- Feature Set
- System Architecture
- Repository Structure
- Tech Stack
- End-To-End Request Lifecycle
- API Surface
- Environment Variables
- Setup And Run
- Monitoring And Observability
- Data Sources And Query Routing
- Documentation Index
- Known Gaps And Future Improvements

## Project Goals

- Give business users a single conversational interface for order analytics.
- Improve response reliability by classifying each question as SQL-first or retrieval-first.
- Keep the UX responsive with streaming responses and guided follow-up prompts.
- Collect explicit quality feedback and run telemetry for continuous improvement.

## Feature Set

- Hybrid SQL and RAG routing with confidence-based decisioning.
- Databricks SQL execution for structured analytics.
- Databricks vector retrieval across order and analytics indexes.
- Session-aware context carryover through Redis.
- Automatic chat title generation from first user message.
- Streaming assistant output for retrieval responses.
- Per-message like/dislike feedback with optional comments.
- MLflow request instrumentation for timing, route, and quality metrics.
- Local chat history with search, pin, rename, and delete in sidebar.

## System Architecture

High-level flow:

1. User sends a question from the chat interface.
2. API classifies query intent and confidence.
3. Router decides SQL or RAG, with confidence thresholds and fallback logic.
4. SQL path executes Databricks query and summarizes results with LLM.
5. RAG path retrieves vectors and synthesizes answer with LLM.
6. API returns structured JSON (SQL) or streamed envelope (RAG).
7. UI renders answer, table (if available), and suggested follow-ups.
8. Metrics and metadata are logged to MLflow; context persisted in Redis.

Detailed architecture and sequence diagrams are in [docs/02-architecture-and-flow.md](docs/02-architecture-and-flow.md).

## Repository Structure

Core directories and what they contain:

- app: App Router pages, global layout/styles, and API routes.
- components: Chat UI primitives for conversation, message rendering, and sidebar history.
- lib: Integration layer for Databricks, OpenAI, Redis, and MLflow.
- prompts: Routing/classifier prompt templates.
- public: Static assets.
- docs: Full technical documentation set (added in this project).

Current API route files:

- app/api/chat/route.ts
- app/api/feedback/route.ts
- app/api/generate-title/route.ts

Ingest route folders currently exist as placeholders and do not yet include handlers:

- app/api/ingest/databricks-sync
- app/api/ingest/eventbridge

## Tech Stack

Frontend:

- Next.js 16 App Router
- React 19
- Tailwind CSS 4

Backend and integrations:

- Databricks SQL Statement API
- Databricks Vector Search API
- OpenAI Chat Completions and Embeddings APIs
- Upstash Redis
- Databricks MLflow API

Utilities:

- Axios for HTTP clients
- TypeScript strict mode
- ESLint 9 flat config

## End-To-End Request Lifecycle

For each incoming question:

1. Session context and recent messages are loaded from Redis.
2. Classifier prompt from prompts/sql_rag_classifier.txt is filled with history and question.
3. Classifier output is parsed as route, confidence, reasoning, and optional SQL.
4. Route decision rules are applied:
	- High confidence favors classifier output.
	- Mid confidence SQL can execute with fallback.
	- Low confidence defaults to retrieval.
5. If SQL path:
	- SQL cleaned and executed in Databricks.
	- Results summarized by LLM.
	- Top rows returned as table payload.
6. If RAG path:
	- Query embedding created/cached.
	- Vector search runs against two indexes.
	- Retrieved context passed to LLM for answer generation.
	- Streaming envelope returned with follow-ups and metadata.
7. Context extracted from SQL rows is saved for follow-up questions.
8. Timings and route metrics logged to MLflow.

## API Surface

Quick reference:

- POST /api/chat
  - Input: question, history, sessionId
  - Output: JSON in SQL mode, text stream envelope in RAG mode

- POST /api/feedback
  - Input: messageId, sessionId, rating, optional comment and message texts
  - Output: success or error JSON

- POST /api/generate-title
  - Input: message
  - Output: plain-text short title

Full request and response schemas are in [docs/03-api-reference.md](docs/03-api-reference.md).

## Environment Variables

Create .env.local with the following values:

- OPENAI_API_KEY
- DATABRICKS_HOST
- DATABRICKS_TOKEN
- DATABRICKS_WAREHOUSE_ID
- DATABRICKS_SQL_URL
- DATABRICKS_MLFLOW_EXPERIMENT_ID
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

Detailed variable meanings, defaults, and failure behavior are in [docs/05-operations-and-deployment.md](docs/05-operations-and-deployment.md).

## Setup And Run

1. Install dependencies.

	npm install

2. Add environment variables in .env.local.

3. Start the development server.

	npm run dev

4. Open http://localhost:3000.

Production commands:

- npm run build
- npm run start

Linting:

- npm run lint

## Monitoring And Observability

The app records request telemetry in MLflow when configured:

- Route metadata: SQL vs RAG, confidence, forced route flags.
- Timings: classifier, SQL execution, retrieval, summarization, total latency.
- Outcomes: fallback events, row count, failure flags, answer length.
- Feedback signals: like/dislike and optional comment presence.

MLflow failures do not crash the request path; logging degrades gracefully.

## Data Sources And Query Routing

Primary structured table:

- customer_suppport_agent.raw.orders

Vector indexes:

- customer_suppport_agent.raw.orders_index
- customer_suppport_agent.raw.analytics_index

Feedback table:

- customer_suppport_agent.raw.message_feedback

Additional details about schema usage and classifier behavior are in:

- [docs/02-architecture-and-flow.md](docs/02-architecture-and-flow.md)
- [docs/05-operations-and-deployment.md](docs/05-operations-and-deployment.md)
- [DEMOGRAPHIC_ANALYSIS_GUIDE.md](DEMOGRAPHIC_ANALYSIS_GUIDE.md)

## Documentation Index

- [docs/01-project-overview.md](docs/01-project-overview.md)
- [docs/02-architecture-and-flow.md](docs/02-architecture-and-flow.md)
- [docs/03-api-reference.md](docs/03-api-reference.md)
- [docs/04-frontend-and-state.md](docs/04-frontend-and-state.md)
- [docs/05-operations-and-deployment.md](docs/05-operations-and-deployment.md)

## Known Gaps And Future Improvements

- Ingest API folders are present but currently unimplemented.
- Classifier prompt file contains legacy sections and duplicated instruction blocks that should be consolidated.
- Chat history persists in browser local storage only; there is no server-side archival.
- SQL result pagination is not exposed in UI beyond first 10 displayed rows.

## License And Internal Usage

This repository currently has no explicit open-source license file. Treat it as internal unless a license is added.