---
title: Debug & AI
description: Debug file utilities and DeepSeek AI chat sessions.
---

# Debug & AI

The platform includes a set of development and AI utilities gated by developer permissions. These are intended for administrative and testing use, not for general participants.

---

## Debug File Utilities

Debug uploads have been retired. Existing files remain accessible at their original `/assets/uploads/*` and `/userast/*` URLs. The application no longer schedules cleanup of debug permalink files.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/debug/files` | `nethack.Debug.filesRead` or `nethack.all` | List existing files in the static and top-level user asset collections |
| GET | `/api/assets/references` | Authenticated user; `nethack.all` lists all owners | List the caller's active references with pagination |
| DELETE | `/api/assets/references/:referenceId` | Reference owner or `nethack.all` | Remove the reference record while preserving the file |

Debug routes return 404 in production. Set `DISABLE_DEBUG_ROUTES=true` to disable them in non-production environments. Where debug routes are enabled, the retired `POST /api/debug/upload` route responds with 410 for requests that pass the global middleware.

---

## DeepSeek AI Chat Sessions

The DeepSeek integration provides an in-memory chat interface in the mod portal. It uses the OpenAI SDK pointing at the DeepSeek API (`https://api.deepseek.com`).

### Lazy Initialization

The OpenAI client is initialized lazily on first use. If `DEEPSEEK_API_KEY` is missing, the endpoint returns:

```json
{
    "statusCode": 503,
    "statusMessage": "DEEPSEEK_API_KEY is not configured"
}
```

This prevents the server from crashing at startup when the key is not provided.

### Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/debug/deepseek/sessions` | `nethack.Debug.deepseekWrite` or `nethack.all` | Create a new chat session |
| GET | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekRead` or `nethack.all` | Get session and messages |
| DELETE | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekWrite` or `nethack.all` | Delete a session |
| POST | `/api/debug/deepseek/sessions/:id/message` | `nethack.Debug.deepseekWrite` or `nethack.all` | Send a message and run tools |

The message endpoint also calls `requireUser` so the current user row can be injected into the system prompt.

### Session Store

Sessions are stored in memory via `server/utils/deepseek-store.ts`:

```ts
interface ChatSession {
    id: number;
    sessionName: string;
    createdAt: number;
    messages: ChatCompletionMessage[];
}
```

::: warning All chat data is lost when the server restarts. :::

### Limits

- `MAX_SESSIONS` = 100
- `MAX_MESSAGES_PER_SESSION` = 200
- `SESSION_TTL_MS` = 24 hours

### Character Prompt

DeepSeek is instructed to role-play as **Barron Wang** with a casual, terse style. Key traits:

- Short phrases, often 1–3 sentences.
- Frequent use of `lol`, `bruh`, `oof`, `sure`, `nice`.
- Typing-delay simulation via `<br delay=X>` tags.
- English-only responses.
- Avoids corporate or overly polite language.

The system prompt also injects context about the Developers' Club (`biszweb.club`) and the current user as JSON.

### Available Tools

The chatbot can invoke functions in a loop (max 10 iterations):

| Tool               | Purpose                                |
| ------------------ | -------------------------------------- |
| `get_time`         | Returns the current GMT+8 time         |
| `crawl_web`        | Fetches raw HTML from a URL            |
| `view_web`         | Fetches a markdown conversion of a URL |
| `end_conversation` | Ends the session with a severity flag  |
| `foward_message`   | Forwards a message to club admins      |

Tool results are appended to the session as `role: 'tool'` messages and the conversation continues until no more tool calls are requested. The model is `deepseek-v4-flash` with reasoning effort set to `high` and thinking enabled.

### UI

The mod portal page `/developers/deepseek` provides the chat UI and is available to admins through the developers dashboard. Its API calls use the route-level permissions listed above.

---

## Removed Microsoft Teams integration

The Microsoft Graph integration, its ROPC credentials, meeting/chat helpers, subscription refresh, and webhook validation were removed. `POST /api/_webhooks/update` and `POST /api/_webhooks/lifecycle` remain only to return `404` for a stale subscription. There is no startup dependency on Microsoft Graph.

---

## Permissions

| Permission                    | Allows                                                  |
| ----------------------------- | ------------------------------------------------------- |
| `nethack.Debug.filesRead`     | List uploaded filenames and permalink references        |
| `nethack.Debug.filesWrite`    | Legacy file-write permission retained for compatibility |
| `nethack.Debug.deepseekRead`  | Read DeepSeek sessions and messages                     |
| `nethack.Debug.deepseekWrite` | Create, update, and delete DeepSeek sessions            |

`nethack.all` grants all of these permissions.

---

## Source Files

- `server/utils/deepseek-store.ts` — in-memory session store
- `server/api/debug/deepseek/sessions/index.post.ts`
- `server/api/debug/deepseek/sessions/[id]/index.get.ts`
- `server/api/debug/deepseek/sessions/[id]/index.delete.ts`
- `server/api/debug/deepseek/sessions/[id]/message.post.ts`
- `server/api/debug/upload.post.ts`
- `server/api/debug/files.get.ts`
- `app/pages/developers/deepseek.vue`
- `app/pages/developers/debug.vue`
