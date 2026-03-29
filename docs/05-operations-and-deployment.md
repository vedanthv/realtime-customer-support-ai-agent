# Operations And Deployment

## Operational Summary

This guide covers configuration, runtime dependencies, deployment flow, observability, and troubleshooting.

## Environment Variables

All runtime integrations rely on environment configuration in .env.local for development and platform secrets for production.

### Required For Core Functionality

- OPENAI_API_KEY
  - Used by classifier, summarizer, follow-up generator, title generator, and embeddings.
- DATABRICKS_HOST
  - Base URL for Databricks REST APIs.
- DATABRICKS_TOKEN
  - Bearer token for SQL, vector search, and MLflow API calls.
- DATABRICKS_WAREHOUSE_ID
  - Warehouse target for SQL statement execution.
- DATABRICKS_SQL_URL
  - Full URL used by chat route SQL fetch execution.
- UPSTASH_REDIS_REST_URL
  - Redis endpoint for session history and context.
- UPSTASH_REDIS_REST_TOKEN
  - Redis auth token.

### Optional But Recommended

- DATABRICKS_MLFLOW_EXPERIMENT_ID
  - If missing, MLflow logging is disabled gracefully.

## Startup And Build Commands

From package.json scripts:

- Development: npm run dev
- Build: npm run build
- Start production: npm run start
- Lint: npm run lint

Development server runs on host 0.0.0.0 and port 3000.

## Dependency Landscape

Key runtime dependencies:

- next 16.2.1
- react 19.2.4
- react-dom 19.2.4
- axios
- openai
- @upstash/redis
- framer-motion
- lucide-react
- react-markdown

Developer dependencies:

- typescript 5
- eslint 9
- eslint-config-next
- tailwindcss 4
- postcss tooling

## Data Integrations

### Databricks SQL

- Primary warehouse analytics source.
- Executed via SQL statements endpoint.
- Statement timeout behavior set in app and helper layers.

### Databricks Vector Search

- Two indexes queried in hybrid mode.
- Scores normalized per index and merged globally.

### Redis Session Storage

Keys:

- chat:{sessionId}
- chat_ctx:{sessionId}

Policies:

- 1-hour expiry.
- chat list trimmed to 20 entries.

### MLflow Tracking

Run lifecycle:

1. Start run.
2. Log tags and params.
3. Log stage timings and outcome metrics.
4. End with FINISHED or FAILED.

Failure strategy:

- MLflow logging failures do not fail the request.
- Repeated 4xx errors can disable MLflow writes for process lifetime.

## Prompt Operations

Classifier prompt source:

- prompts/sql_rag_classifier.txt

Operational note:

- Prompt currently includes mixed-format and legacy blocks. Consolidating this file is recommended to reduce ambiguity.

## Security And Risk Posture

Current posture observations:

1. API endpoints do not enforce user authentication.
2. Feedback insert uses escaped string interpolation, but prepared statement strategy would be safer long-term.
3. Secrets are consumed from environment variables and must never be committed.
4. No explicit rate limiting is present on API routes.

Recommended hardening:

1. Add auth middleware for API routes.
2. Add request-level rate limiting.
3. Add abuse protection for feedback endpoint.
4. Add role-based access for analytics scope.

## Performance Characteristics

Known controls:

- HTTP client timeouts for OpenAI, Databricks, MLflow.
- SQL request abort timeout in chat route.
- Embedding cache with 5-minute TTL.
- Streaming chunking for RAG responses.

Potential bottlenecks:

- Classifier and summarizer serial LLM calls can compound latency.
- Vector retrieval fan-out depends on index response time.
- Shared process-level context variable may create cross-request ambiguity.

## Deployment Checklist

1. Configure all required environment variables.
2. Validate Databricks warehouse and vector index access.
3. Validate Redis connectivity.
4. Configure MLflow experiment ID if telemetry required.
5. Run npm run lint.
6. Run npm run build.
7. Smoke test:
   - SQL route request
   - RAG route request
   - feedback submission
   - title generation

## Troubleshooting Guide

### Symptom: Chat always goes to RAG

Checks:

1. Inspect classifier prompt formatting and JSON output reliability.
2. Verify confidence thresholds and parsed confidence values.
3. Verify SQL generation not returning empty or invalid SQL.

### Symptom: SQL errors or empty tables

Checks:

1. Validate DATABRICKS_SQL_URL, token, and warehouse ID.
2. Verify schema and table names are available in environment.
3. Inspect classifier-generated SQL for unsupported column references.

### Symptom: No context carryover in follow-up questions

Checks:

1. Verify Redis env variables and connectivity.
2. Confirm session_id persists on client.
3. Confirm chat_ctx writes are successful.

### Symptom: Missing MLflow records

Checks:

1. Ensure DATABRICKS_MLFLOW_EXPERIMENT_ID is set.
2. Check for 4xx errors that disable MLflow logger.
3. Confirm Databricks token has experiment logging rights.

### Symptom: Feedback appears to do nothing

Checks:

1. Verify /api/feedback returns success true.
2. Check message_feedback table insert permissions.
3. Confirm UI submitted state is not masking failed retries.

## Maintenance Recommendations

1. Add tests for route decision logic and stream envelope parser.
2. Add integration test harness for SQL and vector paths.
3. Refactor classifier prompt into a single coherent contract.
4. Introduce typed API schemas for stricter client/server contract validation.
