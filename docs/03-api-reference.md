# API Reference

## API Overview

This project exposes three implemented endpoints:

1. POST /api/chat
2. POST /api/feedback
3. POST /api/generate-title

Two additional ingest folders exist but currently have no route handler files.

## 1) POST /api/chat

File: app/api/chat/route.ts
Runtime: nodejs

### Purpose

Handles conversational analytics requests by choosing SQL or RAG execution mode.

### Request Body

Type shape:

- question: string (required)
- history: array (optional)
- sessionId: string (optional, strongly recommended)

Example:

{
  "question": "Show monthly revenue trend",
  "history": [
    { "role": "user", "content": "Give me order analytics" },
    { "role": "assistant", "content": "..." }
  ],
  "sessionId": "b8f2f1b2-5c0d-4f11-9e70-2a8c6a4c8150"
}

### SQL Mode Response

Content-Type: application/json

Fields:

- answer: string
- table: array of row objects (display preview max 10)
- totalRows: number
- displayedRows: number
- hasMoreRows: boolean
- followUps: array of string
- mode: SQL
- reason: string
- classifier_confidence: number
- context: object or null
- requestId: string

Example:

{
  "answer": "Revenue increased month over month...",
  "table": [{ "month": 1, "revenue": 12890.3 }],
  "totalRows": 12,
  "displayedRows": 10,
  "hasMoreRows": true,
  "followUps": ["Compare by region", "Show top channels", "Highlight anomalies"],
  "mode": "SQL",
  "reason": "High-confidence time-series analytics query.",
  "classifier_confidence": 0.98,
  "context": { "order_id": [101, 102] },
  "requestId": "d7a7f572-114d-4f75-a918-0f77b39c8736"
}

### RAG Mode Response

Content-Type: text/plain; charset=utf-8
Transfer: streamed

Response is a stream composed of:

1. Plain answer text chunks.
2. Follow-up marker and JSON payload:
   - newline + __FOLLOWUPS__ + JSON array
3. Meta marker and JSON payload:
   - newline + __META__ + JSON object

Meta object fields:

- mode
- reason
- classifier_confidence
- context
- requestId

Client parses this envelope using parseStreamEnvelope in components/chat.tsx.

### Route Decision Rules

- confidence >= 0.85: trust classifier.
- 0.70 to below 0.85 with SQL classification: attempt SQL.
- below 0.70: route to RAG.

### Side Effects

- Reads and writes Redis message history.
- Reads and writes Redis query context.
- Logs request telemetry to MLflow if configured.

### Error Behavior

- SQL branch errors return JSON with message field.
- RAG branch errors stream text beginning with Error:.

## 2) POST /api/feedback

File: app/api/feedback/route.ts
Runtime: nodejs

### Purpose

Captures user feedback for individual assistant messages and persists to Databricks table.

### Request Body

Required fields:

- messageId: string
- sessionId: string
- rating: like or dislike

Optional fields:

- comment: string
- assistantMessage: string
- userMessage: string

Example:

{
  "messageId": "chat-1-msg-7",
  "sessionId": "b8f2f1b2-5c0d-4f11-9e70-2a8c6a4c8150",
  "rating": "like",
  "comment": "Good summary",
  "assistantMessage": "Monthly revenue grew 8%...",
  "userMessage": "What is monthly revenue trend?"
}

### Success Response

{
  "success": true
}

### Validation Errors

- Missing required fields -> HTTP 400 with error message.
- Invalid rating value -> HTTP 400 with error message.

### Server Error

- HTTP 500 with:

{
  "error": "Failed to save feedback"
}

### Side Effects

- Inserts into customer_suppport_agent.raw.message_feedback.
- Logs feedback metrics and params to MLflow.

## 3) POST /api/generate-title

File: app/api/generate-title/route.ts

### Purpose

Generates a concise chat title from a user message.

### Request Body

- message: string

Example:

{
  "message": "Show me payment breakdown by region for this quarter"
}

### Response

Content-Type: text/plain

Example response:

Payment breakdown by region

### Sanitization

Generated title is cleaned to remove:

- HTML tags and script/style fragments.
- punctuation and non-word symbols.
- excessive whitespace.
- words beyond first five tokens.

## Unimplemented Ingest APIs

The following directories are present but do not currently expose handlers:

- app/api/ingest/databricks-sync
- app/api/ingest/eventbridge

If these are planned for webhook ingestion, each needs route.ts with method handlers and authentication strategy.

## Cross-Cutting API Notes

1. Authentication
   - No request auth is currently enforced in these endpoints.
2. Rate Limiting
   - No explicit API throttling middleware is currently present.
3. Idempotency
   - Feedback submissions are controlled at UI level, not API-level deduplication.
4. Request Tracing
   - Chat endpoint emits requestId for correlation.
