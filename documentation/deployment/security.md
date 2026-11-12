---
title: Security Considerations
description: Security measures and best practices in the basishacks platform
---

# Security Considerations

The basishacks platform implements multiple layers of security to protect user data, prevent abuse, and ensure safe operation across all deployment environments.

## HTTP Security Headers

Every response from the Nitro server includes a baseline set of **6 security headers**, set by `server/middleware/security-headers.ts`:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), autoplay=(), encrypted-media=(), picture-in-picture=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<per-response-value>'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |

The `Content-Security-Policy` header includes **10 directives** that restrict resource loading to same-origin sources by default, with allowances for nonce-bound Nuxt SSR scripts, Vue inline styles, font files, image blobs, and data URIs.

The middleware runs for API routes, rendered HTML pages, and static assets. It generates a fresh cryptographic nonce for each response and the Nuxt server hooks apply it to renderer-owned hydration scripts. `script-src` does not allow `'unsafe-inline'`; inline styles remain allowed for Vue and Nuxt UI bindings. The `'unsafe-eval'` source expression is intentionally omitted.

Every `/api` response also sets `Cache-Control: private, no-store`, including responses that may vary by authenticated user. This policy applies only to API paths; page and asset cache behavior is configured separately.

## HTML Error Diagnostics

The global Nitro error handler negotiates its response using the request's `Accept` header. Clients accepting `text/html` receive the shared Barry error page showing only the canonical error code in parentheses; error names, descriptions, and stack traces are omitted. Other clients receive the canonical JSON error envelope. HTML error responses set `Cache-Control: no-store` and `Vary: Accept`.

## Security-Critical Environment Variables

The following environment variables directly affect platform security and must be configured carefully in production:

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `BASIS_AUTH_COOKIE_SECRET` | At least 32 bytes | Encryption key for sessions and server-side token records |
| `BASIS_AUTH_CLIENT_SECRET` | Provider-generated confidential value | Authenticates basishacks at the basis-auth token endpoint |
| `BASIS_AUTH_ISSUER` | Exact trusted issuer; HTTPS required in production | Discovery and issuer validation |
| `BASIS_AUTH_RESOURCE` | Exact registered audience | Resource-token audience validation |
| `CURRENT_URL_ORIGIN` | Public HTTPS origin, without a path | Callback URL and same-origin validation for cookie-authenticated mutations |
| `TRUSTED_PROXY_HOPS` | `0` | Exact trusted proxy count (0–10). Forwarded client addresses are used only when the socket peer exists and the forwarded chain is valid. |
| `MICROSOFT_TENANT_ID` | Valid Microsoft Entra ID tenant | Required for Microsoft Graph API integration |
| `MICROSOFT_CLIENT_ID` | Valid Microsoft Entra ID application ID | Required for Microsoft Graph API integration |
| `MICROSOFT_CLIENT_SECRET` | Valid client secret | Used for the client credentials token flow in `server/plugins/microsoft.ts` |
| `MICROSOFT_WEBHOOK_STATE` | At least 32 bytes when configured; keep it stable across restarts | Validates every notification in a Microsoft Graph webhook batch |
| `MICROSOFT_WEBHOOK_ID` | Graph subscription ID returned on initial setup | Allows the server to refresh its existing subscription after restart |

## Rate Limiting

All API endpoints are protected by an in-memory rate limiter. Sensitive routes consume requests from dedicated buckets:

| Bucket           | Default               | Routes                                 |
| ---------------- | --------------------- | -------------------------------------- |
| General API      | 120 requests / minute | All non-sensitive API routes           |
| Authentication   | 20 requests / minute  | Authentication routes                  |
| Voting / scoring | 30 requests / minute  | `/api/ballot`, `/api/teams/:id/scores` |
| File upload      | 10 requests / minute  | Upload routes                          |

- **Client identification:** Authenticated users are identified by `user:{id}`; unauthenticated requests by `ip:{ip}`
- **Response:** 429 status with `Retry-After` header
- **Configuration:** Override defaults via `RATE_LIMIT_GENERAL_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_VOTE_MAX`, `RATE_LIMIT_UPLOAD_MAX`, and `RATE_LIMIT_WINDOW_MS`
- **Cleanup:** Interval-based cleanup runs at most once every 5 minutes and removes entries with no requests in the last hour

::: warning Rate limiting is in-memory and per-process. Under high concurrency or with multiple server instances, the effective rate limit applies separately to each process. :::

See [Rate Limiting](./rate-limiting.md) for full details.

## Cross-Site Request Forgery (CSRF)

`server/middleware/00.request-security.ts` checks every `POST`, `PUT`, `PATCH`, and `DELETE` request. Cookie-authenticated browser requests must send a matching `Origin` or `Referer`; requests marked `Sec-Fetch-Site: cross-site` are rejected. Production startup requires `CURRENT_URL_ORIGIN` to be an HTTPS origin with no path, query, fragment, or credentials. Requests authenticated with an explicit `Authorization` header bypass this browser-cookie check and remain protected by token validation and route permissions.

The application streams API request bodies through a **1 MiB default limit** before route validation. The user profile handler authenticates and authorizes a caller before reading its separate 10 MiB allowance for base64-encoded images. Microsoft Graph webhook payloads have a stricter 64 KiB streaming cap before JSON parsing. The webhook handlers fail closed if `MICROSOFT_WEBHOOK_STATE` is missing and validate the state on every notification in a batch. The same persistent value is sent to Graph when the subscription is created; set `MICROSOFT_WEBHOOK_ID` from the initial startup log so subsequent starts refresh that subscription instead of creating duplicates. Keep an ingress request-size cap and body timeout in place as a second boundary. For Nginx, include `deploy/nginx/basishacks-request-limits.conf` inside the site configuration; multipart uploads use their own streamed file and overhead limits. Do not proxy compressed request bodies to the webhook endpoints.

```nginx
client_max_body_size 10m;
client_body_timeout 30s;
```

## Debug Route Lockdown

All `/api/debug/*` routes and both `/debug` pages require an administrator or an appropriately scoped developer permission. Debug routes are automatically disabled in production and return `404 Not Found`, even when `DISABLE_DEBUG_ROUTES` is unset. In development and test environments, set this variable to disable them as well:

```bash
DISABLE_DEBUG_ROUTES=true
```

When this variable is truthy (`1`, `true`, `yes`, or `on`), requests to `/api/debug/*` or `/debug*` return `404 Not Found` before any route handler executes. This guard is enforced by `server/middleware/debug-lockdown.ts` and operates independently of route-level permission checks.

## Persistent Upload Storage

Set `ASSET_STORAGE_DIR` to an absolute, writable persistent directory outside the application release, such as `/var/lib/basishacks/assets`. Production startup rejects a path inside the release working directory. If omitted, assets default to `~/.local/share/basishacks/assets` (or `${XDG_DATA_HOME}/basishacks/assets`). Configure the directory ownership and permissions for the service account and back it up with the database. Uploads are streamed to temporary files with a 10 MiB file limit and a 64 KiB multipart overhead budget; file names are generated by the server, allowed file signatures are checked, SVG is refused, and download routes set `nosniff` plus a restrictive content policy.

When upgrading from a release that stored profile images under `public/userassets`, copy that directory's contents into `${ASSET_STORAGE_DIR}/userassets` before switching traffic to the new release. Preserve the files and verify ownership/read access as the service account. Keep a backup of the old files until profile images have been checked after cutover.

Avatar and profile theme uploads accept JPEG, PNG, and WebP images up to 7 MiB decoded. Their base64 JSON body is bounded by the 10 MiB profile-update limit; decoding validates the content size, base64 structure, and file signature before persisting the image.

## Session Security

- **Cookie and token encryption key** (`BASIS_AUTH_COOKIE_SECRET`) must be at least 32 bytes.
- Basis-auth token cookies use AES-256-GCM encryption, `httpOnly: true`, `sameSite: "lax"`, and `secure: true` in production.
- The separate basis-auth transaction session contains state, nonce, PKCE verifier, and a safe relative redirect. It is HTTP-only, encrypted, SameSite=Lax, secure in production, and limited to **10 minutes**.
- The browser cannot read access or refresh tokens. `/api/auth/session` exposes only the user ID, expiry, and permissions.
- The full user record is fetched from the database on every authenticated request.

### Startup Validation

Critical authentication configuration is validated at server startup in `server/plugins/validate-environment.ts`:

| Variable | Validation | Production Behavior | Non-Production Behavior |
| --- | --- | --- | --- |
| `BASIS_AUTH_COOKIE_SECRET` | Must be set and at least 32 bytes (UTF-8 encoded) | `process.exit(1)` with fatal error message | Stderr warning, continues |
| `BASIS_AUTH_ISSUER`, `BASIS_AUTH_CLIENT_ID`, `BASIS_AUTH_CLIENT_SECRET`, `BASIS_AUTH_RESOURCE` | All must be set | Fatal startup error when any is missing | Warning; login unavailable until configured |
| `MICROSOFT_*` env vars | All three must be set for Graph features | Warning if partially configured | Warning if partially configured |

Resource access tokens are verified against basis-auth JWKS and are never signed by basishacks.

## Database Security

- **Foreign keys** are declared and enforced by PostgreSQL.
- All database access goes through Drizzle ORM (`event.context.drizzle.select()/insert()/update()/delete()`); no raw string interpolation is used.
- User input is bound as query parameters; SQL metacharacters such as `' OR 1=1 --` or `'; DROP TABLE users; --` are treated as literal values and cannot alter query logic.
- Raw SQL is limited to migrations and operational tooling such as the one-time SQLite importer; identifiers are fixed or allow-listed and user input is bound as a parameter.
- Regression tests in `tests/api/sql-injection.test.ts` exercise endpoints and database helpers with SQL metacharacters to verify they are stored and matched as literals.
- The database layer uses Drizzle ORM with the `postgres` driver under both Bun and Node.js.

## Input Validation

- **Zod validation** is performed on every API endpoint using `readValidatedBody(event, Schema.parse)` or `getValidatedQuery(event, Schema.parse)`
- Shared schemas in `shared/schemas.ts` are the single source of truth for input constraints
- Validation errors return structured 400 responses

## Server-Side URL Validation (SSRF Protection)

External URLs fetched by the server are validated through `server/utils/url-validation.ts` to prevent Server-Side Request Forgery (SSRF) attacks:

- Only `http:` and `https:` protocols are allowed; other protocols (`file:`, `ftp:`, etc.) are rejected
- Private and loopback IP ranges are blocked: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `127.x.x.x`, `169.254.x.x`, `0.x.x.x`, multicast (`224-239.x.x.x`), IPv6 link-local (`fe8:`/`fe9:`/`fea:`/`feb:`), unique-local (`fc:`/`fd:`), IPv6 loopback (`::1`), and `localhost`
- DNS rebinding protection is applied at fetch time — every redirect hop is re-validated through `validateExternalUrl()`
- A maximum of **5 redirects** is enforced with `redirect: "manual"` to prevent open-redirect chains
- Response body is capped at **15 KB**

```ts
export function validateExternalUrl(urlString: string): URL {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw ...;
    if (isPrivateHost(url.hostname)) throw ...;
    return url;
}
```

## Open Redirect Prevention

All redirect parameters in the login flow are validated to prevent open redirect attacks:

- **`login.get.ts`** — The `postLoginRedirect` parameter is allowed only when it does not start with `http://`, `https://`, or `//` (protocol-relative). Only relative paths are accepted.
- **`dccallback.get.ts`** — The OAuth2 onsite login callback validates redirects before following them, ensuring they point to relative paths only.
- **`SafeLink.vue`** — User-provided links in rendered content (e.g. project descriptions) are rendered through the `SafeLink` component, which validates URLs with `isSafeUrl()` — only relative paths rooted at `/` and `http:`/`https:` URLs are rendered as clickable links; unsafe URLs are shown as plain strikethrough text.
- **`SafeComark.vue`** — Markdown content rendered from user input uses the `SafeLink` component as its link renderer via `Comark`, and HTML rendering is disabled.

## Unified Client Credential Errors

The OAuth2 token endpoint (`token.post.ts`) returns a single, generic `"Invalid client credentials"` error for all token exchange failures — whether the client ID is unknown, the secret is wrong, or both. This prevents **user enumeration** through error message differences:

```ts
if (!app || !isSecretValid) {
    throw createError({
        statusCode: 400,
        statusMessage: "invalid_client",
        message: "Invalid client credentials", // Same message for every failure
    });
}
```

## Token custody

Access and refresh tokens are sealed with AES-256-GCM into the HTTP-only `basis-auth-tokens` cookie; browser JavaScript cannot read it. `GET /api/auth/session` returns only the user ID, expiry, and permission list for display. Protected APIs validate the token from the cookie or an explicit bearer header, including signature, issuer, audience, expiry, token type, and permissions. Admin impersonation is not supported.

## Role-Based Access Control (RBAC)

- RBAC is enforced **server-side**; the frontend never performs permission checks for authorization.
- Three helper functions validate the bearer identity and then enforce access:
    - `requireUser(event)` — returns the full database user row or `401 Unauthorized`.
    - `requireJudge(event)` — returns `403 Forbidden` if the caller is not a judge or administrator.
    - `requireAdmin(event)` — returns `403 Forbidden` if the caller is not an administrator.
- Fine-grained permissions are checked against the verified basis-auth JWT `permissions` array using `NethackPermissions` from `shared/permissions.ts`.
- The local user table contains no authorization role; `nethack.all` is the explicit administrative grant.

::: danger Never trust the frontend for permission checks. Always validate on the server. :::

## Microsoft Graph API

- All Microsoft Graph API calls are centralized in `server/plugins/microsoft.ts` for auditability
- Graph configuration reads the tenant and client ID from `MICROSOFT_TENANT_ID` and `MICROSOFT_CLIENT_ID`.
- Graph features are independent from basis-auth and cannot authenticate a basishacks session.

## OAuth2 Client Secret Storage

Client secrets are **never stored in plaintext**. Instead:

1. When a new secret is generated, it is created using `crypto.randomBytes(32).toString('hex')`
2. The plain secret is hashed with **SHA-256** before storage: `createHash('sha256').update(plainSecret).digest('hex')`
3. Multiple secrets can be stored per application, space-separated in the `client_secret` column
4. Only the abbreviated hash (`sha256:XXXXXXXX...XXXXXXXX`) is shown in the UI
5. The plain secret is shown **only once** at creation time and cannot be recovered

```ts
// Secret creation
const plainSecret = randomBytes(32).toString("hex");
const secretHash = createHash("sha256").update(plainSecret).digest("hex");

// Secret validation
const hash = createHash("sha256").update(plainSecret).digest("hex");
if (part === hash) return true;
```

## Resource Access Tokens

Protected basishacks APIs accept basis-auth access tokens with the following required properties:

- **Signature:** basis-auth JWKS, RS256 only
- **Issuer:** exact `BASIS_AUTH_ISSUER`
- **Audience:** exact `BASIS_AUTH_RESOURCE`
- **Type:** `at+jwt`
- **Lifetime:** token must be unexpired
- **Claims:** string `sub`, `client_id`, and `scope`

Token verification uses `jose.jwtVerify()` and a remotely refreshed basis-auth JWKS. The stable `sub` is mapped through `users.auth_issuer` and `users.auth_subject`.

## PKCE Support

The basis-auth browser flow always generates a fresh verifier and sends an S256 challenge. The verifier, state, and nonce remain only in the encrypted short-lived transaction session, and `openid-client` validates all three during callback processing.

## Sensitive Scope Consent

When an application requests a scope marked as `sensitive: true` in `shared/oauth2-scopes.ts`, the authorization flow requires **explicit user consent**:

1. The user is redirected to a consent page
2. The user can approve (`consent`), deny (`deny`), or cancel (`cancel`)
3. Only after consent is the authorization code issued

This prevents applications from silently accessing sensitive user data such as chat messages or all meetings.

---

## XSS Prevention Audit

A comprehensive XSS audit has been performed across all frontend components (`app/` directory, 50+ `.vue`/`.ts` files):

- **No `v-html` usage**: zero instances. All user-controlled text renders through Vue's auto-escaping `{{ }}` interpolation.
- **No `innerHTML`** or `dangerouslySetInnerHTML`: zero instances.
- **SafeLink component**: validates all `href` attributes via `isSafeUrl()` before rendering; unsafe URLs render as inert `<span>` elements.
- **SafeComark component**: renders user project descriptions with HTML escaping before Markdown processing.
- **URL safety**: all project demo/repo URLs use `safeUrl()` computed properties; file upload URLs use sanitized UUID-based filenames.
- **Form maxlength attributes**: all key form inputs (`ProjectForm.vue`, `JudgingCard.vue`, `voting.vue`) now have `:maxlength` bound to the `MAX_*` constants from `shared/schemas.ts`, preventing users from exceeding validation limits before submission.

**Result: Zero XSS vectors found.** The frontend is fully hardened against cross-site scripting attacks.

---

<QuoteCycler />
