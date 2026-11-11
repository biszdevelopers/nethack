---
title: Plugins & Middleware
description: Nitro plugins and server middleware in the basishacks backend
---

# Plugins & Middleware

Nitro plugins run at server startup and can hook into the request lifecycle. Server middleware runs on every request before API handlers.

---

## Plugins

### init-database.ts

**File:** `server/plugins/init-database.ts`

Initializes the PostgreSQL pool, applies migrations and seeds before the server accepts requests, and closes the pool during Nitro shutdown.

At startup the plugin calls `createDrizzleDatabase()` from `server/database/index.ts`, which performs the following steps:

1. Validates `DATABASE_URL` and `DATABASE_POOL_MAX`.
2. Creates the bounded `postgres` connection pool and Drizzle instance.
3. Runs PostgreSQL migrations under an advisory lock and seeds the `hackathon` singleton row if it is missing.

#### Request Hook

The shared instance uses a bounded PostgreSQL connection pool. Migrations and seeding finish before Nitro accepts requests.

### 02.database.ts

**File:** `server/middleware/02.database.ts`

Attaches the initialized Drizzle instance to `event.context.drizzle` before each request reaches a route handler. Database helpers and API handlers read the request's shared instance from that context.

---

### validate-environment.ts

**File:** `server/plugins/validate-environment.ts`

Comprehensive environment variable validation plugin that runs at server startup. Performs mandatory checks on critical configuration values:

#### `BASIS_AUTH_COOKIE_SECRET`

| Condition             | Production                     | Development/Test |
| --------------------- | ------------------------------ | ---------------- |
| Missing or < 32 bytes | Fatal error, `process.exit(1)` | Warning logged   |
| >= 32 bytes           | OK                             | OK               |

#### basis-auth client configuration

`BASIS_AUTH_ISSUER`, `BASIS_AUTH_CLIENT_ID`, `BASIS_AUTH_CLIENT_SECRET`, and `BASIS_AUTH_RESOURCE` are required together. Missing values stop production startup and warn during development.

#### Microsoft Graph configuration

Checks `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, and `MICROSOFT_CLIENT_SECRET`:

- If any are set but not all three, logs a warning that Microsoft Graph features will be unavailable.
- If none are set, silently skips (Microsoft features gracefully disabled).

```ts
// server/plugins/validate-environment.ts — core pattern
if (!sessionPassword || sessionPasswordLength < 32) {
    if (isProduction) {
        console.error("[FATAL] ...");
        process.exit(1);
    } else {
        console.warn("[WARNING] ...");
    }
}
```

---

### microsoft.ts

**File:** `server/plugins/microsoft.ts`

Microsoft Graph API integration plugin. The default export attempts to initialize the application access token at startup when `MICROSOFT_TENANT_ID` and `MICROSOFT_CLIENT_ID` are configured; otherwise it logs a warning and Microsoft Graph features remain unavailable. When a persistent `MICROSOFT_WEBHOOK_STATE` is configured, startup creates a webhook subscription on first setup and refreshes the existing subscription when `MICROSOFT_WEBHOOK_ID` is set. All Microsoft Graph API calls are centralized in this file for auditability.

::: warning Security Policy All Microsoft Graph API calls MUST be made through the wrappers in this file. Never call the Graph API directly from other modules. :::

#### Token Management

| Function | Description |
| --- | --- |
| `initializeMSAccessToken()` | Obtains an app-level access token via client credentials flow |
| `getMSAccessToken()` | Returns the cached app-level token (lazy-initializes on first use) |
| `initializeDummyUserAccessToken()` | Obtains a user-level token via ROPC flow for chat operations |
| `getDummyUserAccessToken()` | Returns the cached user-level token |

**App-level token:** Used for administrative operations (creating meetings, managing webhooks). Uses `client_credentials` grant type.

**User-level token:** Used for chat operations (sending messages). Uses ROPC (Resource Owner Password Credentials) grant type with the dummy user. Auto-refreshes on 401 errors.

#### Meeting Management

```ts
export async function createMicrosoftMeeting(
    target: string,
    subject: string,
    htmlDescription: string,
    startTime: string,
    endTime: string,
    attendees: any[],
): Promise<Response>;
```

Creates a Microsoft Teams calendar event on behalf of a target user. Appends an auto-generated disclaimer to the event description.

#### Chat Operations

```ts
export async function createOrGetExistingDirectChat(targetId: string): Promise<{ id: string }>;
```

Creates or retrieves a 1:1 chat between the dummy user and a target user. Results are cached in-memory (`directChatCache` map) to avoid repeated Graph API calls.

```ts
export async function sendChatMessage(chatId: string, content: string): Promise<Response>;
export async function sendRichChatMessage(chatId: string, content: string): Promise<Response>;
```

Sends a plain text or HTML message to a Microsoft Teams chat.

#### Webhook Management

```ts
export async function initializeChatbotWebhook(): Promise<void>;
```

Creates a Microsoft Graph subscription for chat message notifications:

- **Change type:** `created,updated`
- **Resource:** `/chats/getAllMessages`
- **Notification URL:** `{CURRENT_URL_ORIGIN}/api/_webhooks/update`
- **Lifecycle URL:** `{CURRENT_URL_ORIGIN}/api/_webhooks/lifecycle`
- **Expiration:** 1 day (must be refreshed regularly)
- **Client state:** Random 89-byte base64url string for validation

```ts
export async function refreshChatbotWebhook(): Promise<void>;
```

Extends the webhook subscription expiration by 1 day.

```ts
export function getMicrosoftWebhookState(): string | null;
export function getChatbotWebhookId(): string | null;
```

Returns the current webhook state and subscription ID.

#### Polling

```ts
export async function pollChatbotMessages(): Promise<void>;
```

Manually polls chat messages via the delta endpoint (fallback for webhook failures).

#### Internal Request Helpers

| Function | Description |
| --- | --- |
| `requestMicrosoft(endpoint, method, body)` | Makes an authenticated request using the app-level token (refreshes once on 401) |
| `requestUserMicrosoft(endpoint, method, body)` | Makes an authenticated request using the user-level token (auto-refreshes on 401) |

---

## Middleware

### security-headers.ts

**File:** `server/middleware/security-headers.ts`

Applies a baseline set of HTTP security headers to every Nitro response (HTML pages, API JSON responses, and static assets). A server middleware is used instead of Nuxt `routeRules` so API routes receive the same headers as page routes without duplication.

| Header | Value | Purpose |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS for two years, include subdomains, and declare HSTS preload eligibility. |
| `X-Frame-Options` | `DENY` | Prevent clickjacking by disallowing framing. |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Send full URL for same-origin requests, only origin for cross-origin. |
| `Permissions-Policy` | `camera=(), microphone=(), ...` | Disable powerful browser features the app does not use. |
| `Content-Security-Policy` | See below | Restrict resource loading to trusted origins. |

#### Content Security Policy

The CSP is strict but functional for the Nuxt 4 + `@nuxt/ui` stack:

```
default-src 'self';
script-src 'self' 'nonce-<per-response-value>';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' blob: data:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

- A fresh cryptographic nonce is generated for every response and attached to Nuxt hydration scripts. Inline scripts without that nonce are blocked.
- `'unsafe-inline'` for `style-src` is required for inline style bindings used by Vue / Nuxt UI components.
- `'unsafe-eval'` is intentionally omitted.

### debug-lockdown.ts

**File:** `server/middleware/debug-lockdown.ts`

Runs on every request and returns `404 Not Found` for exact `/api/debug` and `/debug` route trees in production, regardless of `DISABLE_DEBUG_ROUTES` or route-level permission checks. In development and test environments, set `DISABLE_DEBUG_ROUTES` to `1`, `true`, `yes`, or `on` to disable those routes too. Matching uses the parsed URL pathname, so query strings cannot bypass the guard and similarly prefixed paths such as `/debugger` are not blocked.

| Path pattern           | Disabled response |
| ---------------------- | ----------------- |
| `/api/debug/*`         | 404 Not Found     |
| `/debug` or `/debug/*` | 404 Not Found     |
