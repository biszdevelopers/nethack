---
title: Debug & AI
description: Debug file utilities, DeepSeek AI chat sessions, and the Microsoft Teams chatbot integration.
---

# Debug & AI

The platform includes a set of development and AI utilities gated by developer permissions. These are intended for administrative and testing use, not for general participants.

---

## Debug File Utilities

Debug file endpoints let authorized users upload and list static assets without going through the normal project-submission flow.

### Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/debug/upload` | `dev_debug` or admin | Stream one bounded file into persistent asset storage |
| GET | `/api/debug/files` | `portal.debug.view` or admin | List uploaded assets |

### Upload Request

`POST /api/debug/upload` accepts `multipart/form-data`:

| Field          | Description                                         |
| -------------- | --------------------------------------------------- |
| `file`         | The file to upload                                  |
| `mode` (query) | `static` → `/assets/uploads/`, `user` → `/userast/` |

Uploads accept exactly one file part named `file`, with a maximum file size of 10 MiB. The request parser rejects extra fields/parts and caps multipart overhead at 64 KiB. Filenames are always replaced with random UUIDs. Allowed extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `pdf`, `txt`, `md`, `json`, `zip`, and `mp4`; SVG is rejected. Raster images, PDF, ZIP, and MP4 signatures are checked against their extensions. The request is streamed to a temporary file, then published after the limits and content checks pass.

Response:

```json
{
    "permalink": "/assets/uploads/<uuid>.<extension>"
}
```

For `mode=user` the response path is `/userast/<uuid>.<extension>`. Files are stored under `ASSET_STORAGE_DIR/userassets`; static uploads are stored under `ASSET_STORAGE_DIR/assets/uploads`. Set `ASSET_STORAGE_DIR` to an absolute persistent directory outside the release tree. If omitted, the runtime uses the OS data directory under `basishacks/assets` (Linux default: `~/.local/share/basishacks/assets`). The file routes set `X-Content-Type-Options: nosniff`, a restrictive CSP, and attachment disposition for non-image/video content.

All cookie-authenticated mutations, including uploads, pass the global same-origin `Origin`/`Referer` check. Requests authenticated with an explicit bearer token do not use cookie-based CSRF protection. Debug routes always return 404 in production; `DISABLE_DEBUG_ROUTES=true` also disables them in non-production environments.

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
| POST | `/api/debug/deepseek/sessions` | `dev_deepseek` | Create a new chat session |
| GET | `/api/debug/deepseek/sessions/:id` | `portal.deepseek.view` | Get session and messages |
| DELETE | `/api/debug/deepseek/sessions/:id` | `dev_deepseek` | Delete a session |
| POST | `/api/debug/deepseek/sessions/:id/message` | `dev_deepseek` | Send a message and run tools |

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

The mod portal page `/developers/deepseek` provides the chat UI. It is gated by `portal.deepseek.view` or admin.

---

## Microsoft Teams Integration

The unused test-message and anonymous no-op routes have been removed. Microsoft Graph webhook notifications continue to use the validated routes below; application login remains independent from Graph.

### Webhooks

Microsoft Graph change notifications are received at:

| Method | Path                       | Description                          |
| ------ | -------------------------- | ------------------------------------ |
| POST   | `/api/_webhooks/update`    | Chat message change notifications    |
| POST   | `/api/_webhooks/lifecycle` | Subscription lifecycle notifications |

Both endpoints first check for a `validationToken` query parameter; when present they respond with `200 OK` and echo the token as `text/plain`. They then validate the `clientState` against `getMicrosoftWebhookState()` and return `403 Forbidden` if it does not match.

`/api/_webhooks/update` returns `200 OK` with the canonical envelope containing `data: { message: "Received" }` after logging the change type and resource.

`/api/_webhooks/lifecycle` returns `202 Accepted` with the canonical envelope containing `data: { message: "Received" }`. When the lifecycle event is `reauthorizationRequired`, it calls `refreshChatbotWebhook()` to extend the subscription.

See [Plugins & Middleware](./plugins-middleware) for subscription creation and refresh details.

---

## Permissions

| Permission             | Allows                                        |
| ---------------------- | --------------------------------------------- |
| `dev_debug`            | Direct access to debug API routes             |
| `portal.debug.view`    | View the Debug Files page in the mod portal   |
| `dev_deepseek`         | Direct access to DeepSeek API routes          |
| `portal.deepseek.view` | View the DeepSeek chat page in the mod portal |

Admins implicitly have all of the above.

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
