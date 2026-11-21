---
title: Plugins & Middleware
description: Nitro plugins and server middleware in the nethack backend
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

#### basis-auth backchannel configuration

`BASIS_AUTH_RESOURCE_SECRET` and `BASIS_AUTH_INTERNAL_URL` are required together, and the URL must use HTTP or HTTPS. They are needed to verify the resource's backchannel logout URL and to receive logout and revocation events; without them authorization-code sign-in fails with `14408 invalid_resource`. Missing or malformed values stop production startup and warn during development.

#### Production origin, proxy trust, and email verification

`CURRENT_URL_ORIGIN` must be a public HTTPS origin with no path, query, fragment, or credentials, or a loopback HTTP origin while the server binds to loopback. `TRUSTED_PROXY_HOPS` must be an integer from 0 to 10; a production value of 0 emits a warning because per-IP limits would collapse to the proxy address. When `REQUIRE_VERIFIED_EMAIL` is disabled in production, the plugin warns that an omitted `email_verified` claim is accepted. Startup failures use `process.exit(1)`.

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

### Removed Graph integration

`server/plugins/microsoft.ts`, its ROPC user credentials, and the webhook validation helpers were removed. The legacy `POST /api/_webhooks/update` and `POST /api/_webhooks/lifecycle` paths remain registered only to return `404`. There is no Microsoft Graph dependency at startup.

---

## Middleware

### 00.request-id.ts

Accepts an incoming `x-request-id` matching `^[A-Za-z0-9._-]{8,128}$` or generates a UUID. Stores it in `event.context.requestId` and echoes it on every response. Audit rows and 5xx logs use the same value.

### 00.request-log.ts

Emits one JSON line after the response finishes, with `event`, `method`, `pathname`, `status`, `duration_ms`, `request_id`, and the user ID when the session was resolved. Static asset paths and file extensions are skipped. It never logs a query string, body, cookie, or token.

### 00.request-rate-gate.ts

Consumes one request from a per-IP fixed window before any body is buffered. It skips `/api/health*` and `/api/auth/basis/backchannel`, and returns `429` with `Retry-After` when the gate is exhausted. Route-level limits still apply.

### security-headers.ts

**File:** `server/middleware/security-headers.ts`

Applies a baseline set of HTTP security headers to every Nitro response (HTML pages, API JSON responses, and static assets). The header logic lives in `server/utils/security-headers.ts` and is reused by the debug lockdown so an early 404 still carries CSP, HSTS, and anti-sniffing headers. A server middleware is used instead of Nuxt `routeRules` so API routes receive the same headers as page routes without duplication.

| Header | Value | Purpose |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS for two years, include subdomains, and declare HSTS preload eligibility. |
| `X-Frame-Options` | `DENY`; `SAMEORIGIN` only on `/docs*` | Prevent clickjacking; allow the admin portal to embed the protected docs. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate the browsing context from cross-origin openers. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Restrict subresources to the same origin. |
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

Runs on every request and returns `404 Not Found` for exact `/api/debug` and `/debug` route trees in production, regardless of `DISABLE_DEBUG_ROUTES` or route-level permission checks. In development and test environments, set `DISABLE_DEBUG_ROUTES` to `1`, `true`, `yes`, or `on` to disable those routes too. Matching uses the parsed, percent-decoded URL pathname, so query strings and encoded separators cannot bypass the guard and similarly prefixed paths such as `/debugger` are not blocked. The rejection applies the shared baseline security headers before throwing, so the 404 response is not missing CSP or anti-sniffing headers.

| Path pattern           | Disabled response |
| ---------------------- | ----------------- |
| `/api/debug/*`         | 404 Not Found     |
| `/debug` or `/debug/*` | 404 Not Found     |
