# Frontend And State Guide

## Frontend Overview

The client uses a single-page chat experience built with Next.js App Router and React client components. The UI emphasizes conversational flow, quick prompts, and contextual continuity.

Primary UI files:

- app/page.tsx
- components/chat.tsx
- components/message.tsx
- components/sidebar.tsx
- app/globals.css

## app/page.tsx

Role:

- Composes page shell, background effects, sidebar, and chat panel.
- Owns selectedChat and sidebarOpen state.

Behavior:

- Sidebar selection updates active thread.
- Mobile menu toggles sidebar visibility.
- Visual ambiance comes from animated orb layers.

## components/chat.tsx

Role:

- Core interaction controller and API client.

Main state variables:

- messages
- input
- loading
- loadingStage
- followUps
- activeContext
- currentChatId
- chatTitle
- sessionId
- showScrollDown

### Initialization

1. Reads or creates session_id in localStorage.
2. Loads selected chat if provided from sidebar.
3. Auto-scrolls as messages update.

### Message Send Pipeline

1. Validate input and session.
2. Generate title on first message.
3. Append user message locally.
4. POST to /api/chat with question, recent history, and sessionId.
5. Branch handling by response content type:
   - application/json for SQL mode.
   - stream for RAG mode.
6. Update message list with assistant response and metadata.
7. Capture follow-up suggestions and context chips.

### Stream Envelope Parsing

parseStreamEnvelope extracts:

- text body.
- follow-up array after marker __FOLLOWUPS__.
- metadata object after marker __META__.

### Context Chip UX

- activeContext displays key/value chips.
- User can remove specific context keys.
- Reset Context action regenerates session and clears active context.

### Local Persistence

Every non-empty message set writes to localStorage key chat_history:

- id
- title
- messages
- context
- updatedAt
- pinned

An event chat_updated is emitted to synchronize sidebar state.

## components/message.tsx

Role:

- Renders a single message bubble with optional table, actions, and feedback controls.

Major features:

1. Mode badge rendering for SQL, RAG, or SYSTEM.
2. Inline formatting for headings, bullets, and bold emphasis.
3. Optional table rendering when response includes tabular data.
4. Utility actions:
   - Regenerate
   - Explain
   - Continue
   - Copy
5. Feedback workflow:
   - Like/dislike selection
   - Optional comment
   - Submit or skip
   - POST to /api/feedback

### Table Component

- Detects columns from first row.
- Shows row count badge.
- Supports copy CSV and download CSV.
- Mobile uses details cards per row.
- Desktop uses horizontally scrollable table.

### Time Labels

Relative timestamp helper outputs:

- just now
- Xm ago
- Xh ago
- locale date

## components/sidebar.tsx

Role:

- Chat history explorer and manager.

Features:

1. Search by title.
2. New chat creation.
3. Clear all history.
4. Pin/unpin chats.
5. Delete chat.
6. Rename chat by double-click.
7. Sorting:
   - pinned first
   - recent by updatedAt descending

Storage behavior:

- Reads and writes localStorage key chat_history.
- Listens to storage and chat_updated events for refresh.

## Styling And Motion

Global styles in app/globals.css include:

- Tailwind import and theme variable mapping.
- Animated ambient background orbs.
- Message entrance animation.
- Loading shimmer animation.

UI choices in components include:

- Gradient accent buttons and avatars.
- Blurred glass-like containers.
- Responsive spacing and typography sizing.

## Frontend Data Contracts

Expected assistant message shape in chat state typically includes:

- role
- content
- mode
- reason
- timestamp
- optional table

Feedback-specific fields passed into Message component:

- messageId
- sessionId
- userMessage

## Frontend Reliability Notes

1. Chat history is local to browser and not shared across devices.
2. If stream reader is unavailable, chat shows a fallback system message.
3. Feedback submission failures are silent in UI and do not block interaction.
4. Copy-to-clipboard assumes browser permissions and secure context support.

## UX Improvement Opportunities

1. Add explicit pagination controls for SQL responses with hasMoreRows true.
2. Surface model route confidence to advanced users optionally.
3. Add loading cancellation for long-running requests.
4. Add optimistic status indicator for feedback submission outcomes.
