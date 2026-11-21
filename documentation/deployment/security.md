---
title: Security Considerations
description: Security measures and best practices in the nethack platform
---

# Security Considerations

The nethack platform implements multiple layers of security to protect user data, prevent abuse, and ensure safe operation across all deployment environments.

## HTTP Security Headers

Every response from the Nitro server includes the baseline security headers below, set by `server/middleware/security-headers.ts`:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY`; `SAMEORIGIN` only on `/docs*` for the admin iframe |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), autoplay=(), encrypted-media=(), picture-in-picture=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<per-response-value>'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |

The `Content-Security-Policy` header restricts resource loading to same-origin sources by default, with allowances for nonce-bound Nuxt SSR scripts, Vue inline styles, font files, image blobs, and data URIs. `frame-ancestors` is `'none'` except on `/docs*`, where it is `'self'`.

The middleware runs for API routes, rendered HTML pages, and static assets. It generates a fresh cryptographic nonce for each response and the Nuxt server hooks apply it to renderer-owned hydration scripts. `script-src` does not allow `'unsafe-inline'`; inline styles remain allowed for Vue and Nuxt UI bindings. The `'unsafe-eval'` source expression is intentionally omitted.

Every `/api` response also sets `Cache-Control: private, no-store`, including responses that may vary by authenticated user. This policy applies only to API paths; page and asset cache behavior is configured separately.

## HTML Error Diagnostics

The global Nitro error handler negotiates its response using the request's `Accept` header. Clients accepting `text/html` receive the shared Barry error page showing only the canonical error code in parentheses; error names, descriptions, and stack traces are omitted. Other clients receive the canonical JSON error envelope. HTML error responses set `Cache-Control: no-store` and `Vary: Accept`.

## Security-Critical Environment Variables

The following environment variables directly affect platform security and must be configured carefully in production:

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `BASIS_AUTH_COOKIE_SECRET` | At least 32 bytes | Encryption key for sessions and server-side token records |
| `BASIS_AUTH_CLIENT_SECRET` | Provider-generated confidential value | Authenticates nethack at the basis-auth token endpoint |
| `BASIS_AUTH_ISSUER` | Exact trusted issuer URL; HTTP or HTTPS | Discovery and issuer validation |
| `BASIS_AUTH_RESOURCE` | Exact registered audience | Resource-token audience validation |
| `BASIS_AUTH_RESOURCE_SECRET` | Provider-generated resource secret | Signs the backchannel webhook proof and authenticates private listener calls |
| `BASIS_AUTH_INTERNAL_URL` | HTTP(S) origin of the private listener, default `http://127.0.0.1:3001` | Webhook verification and user-state checks |
| `CURRENT_URL_ORIGIN` | Public HTTPS origin, without a path; loopback HTTP accepted only while bound to loopback | Callback URL and same-origin validation for cookie-authenticated mutations |
| `TRUSTED_PROXY_HOPS` | `0` | Exact trusted proxy count (0–10). Forwarded client addresses are used only when the socket peer exists and the forwarded chain is valid. |
| `INITIAL_ADMIN_EMAILS` | Comma-separated addresses; unset uses the built-in fallback | Bootstrap administrator allowlist, matched case-insensitively and re-applied at sign-in |
| `REQUIRE_VERIFIED_EMAIL` | `0` or `1` | Reject a missing `email_verified` claim at login; an explicit `false` is always rejected |
| `ENFORCE_DEADLINES` | `1` | Enforce submission and voting deadlines. Set `0` only for an untimed rehearsal |
| `SUBMISSION_GRACE_MS` | `0` | Post-deadline submission grace window |
| `JUDGING_AFTER_PUBLISH` | `0` | Keep judging open after results in a finished season |
| `TEAM_INVITE_TTL_DAYS` | `7` | Invitation link lifetime, 1–365 days |

## Rate Limiting

All API endpoints are protected by an in-memory fixed-window rate limiter. Sensitive routes consume requests from dedicated buckets:

| Bucket | Default | Routes |
| --- | --- | --- |
| Request gate | 6000 requests / minute per IP | Every `/api/*` request before the body is buffered; health and the basis-auth backchannel are exempt |
| General API | 1200 requests / minute | All non-sensitive API routes |
| Judging drafts | 1200 requests / minute per judge | Draft reads, autosaves, and deletes |
| Authentication | 200 requests / minute | Authentication routes |
| Voting / scoring | 300 requests / minute | `/api/ballot`, `/api/teams/:id/scores` |
| File upload | 100 requests / minute | Upload routes |
| basis-auth backchannel | 600 requests / minute | `POST /api/auth/basis/backchannel` |

- **Client identification:** Session user (`user:{id}`), then a SHA-256 prefix of an explicit bearer token (`bearer:{hash}`), then the resolved IP (`ip:{ip}`)
- **Response:** 429 status with `Retry-After`
- **Map bound:** at most 10,000 tracked keys; eviction trims to 9,000
- **Configuration:** Override defaults via the `RATE_LIMIT_*` variables and `RATE_LIMIT_WINDOW_MS`

::: warning Rate limiting is in-memory and per-process. Under high concurrency or with multiple server instances, the effective rate limit applies separately to each process. :::

See [Rate Limiting](./rate-limiting.md) for full details.

## Cross-Site Request Forgery (CSRF)

`server/middleware/00.request-security.ts` checks every `POST`, `PUT`, `PATCH`, and `DELETE` request. Cookie-authenticated browser requests must send a matching `Origin` or `Referer`; requests marked `Sec-Fetch-Site: cross-site` are rejected. Production startup requires `CURRENT_URL_ORIGIN` to be an HTTPS origin with no path, query, fragment, or credentials, or a loopback HTTP origin while the server binds to loopback. Requests authenticated with an explicit `Authorization` header bypass this browser-cookie check and remain protected by token validation and route permissions.

The application streams API request bodies through a **1 MiB default limit** before route validation. The user profile handler authenticates and authorizes a caller before acquiring its upload slot and reading its separate 10 MiB allowance for base64-encoded images against `PROFILE_UPDATE_DEADLINE_MS` (default 30 seconds). Each user may buffer one profile update at a time, and the process allows at most four concurrent profile updates; excess requests are rejected with `503 Service Unavailable` and `Retry-After: 2` before the request body is read. This bounds concurrent decoded-image buffers while keeping the 7 MiB per-image validation and prevents one slow user from blocking everybody else. Keep an ingress request-size cap and body timeout in place as a second boundary. For Nginx, include `deploy/nginx/basishacks-request-limits.conf` inside the site configuration. The retired Graph webhook paths now return `404`.

```nginx
client_max_body_size 10m;
client_body_timeout 30s;
```

## Debug Route Lockdown

Debug API routes require their corresponding `nethack.Debug.*` permission or `nethack.all`. The `/debug` and `/developers/*` dashboard pages are admin-only. Debug API routes and `/debug*` pages are automatically disabled in production and return `404 Not Found`, even when `DISABLE_DEBUG_ROUTES` is unset. In development and test environments, set this variable to disable them as well:

```bash
DISABLE_DEBUG_ROUTES=true
```

When this variable is truthy (`1`, `true`, `yes`, or `on`), requests to `/api/debug/*` or `/debug*` return `404 Not Found` before any route handler executes. Paths are percent-decoded before matching, so encoded separators cannot bypass the guard. The 404 response still carries the baseline security headers. This guard is enforced by `server/middleware/debug-lockdown.ts` and operates independently of route-level permission checks.

## Persistent Upload Storage

Runtime uploads live in the project-root `/assets` directory, which is gitignored and must be writable by the application service account. It remains through an in-place pull/build/start deployment. Back it up separately from PostgreSQL, and preserve or restore it before serving after a re-clone or checkout replacement. Under systemd `ProtectSystem=strict`, grant write access to this directory with `ReadWritePaths`. The committed static showcase at `public/assets` is separate and is not runtime storage.

New profile images use SHA-256 content-addressed names under `/assets/userassets/profiles/`. Identical image bytes with the same canonical extension reuse one object. The scheduled profile collector waits at least seven days, takes the PostgreSQL advisory lock used by profile updates, then checks profile pictures, URL profile themes, and legacy OAuth application pictures before unlinking an unreferenced image. Debug uploads have been retired. Existing files remain accessible at their original `/assets/uploads/*` and `/userast/*` URLs. The application no longer schedules cleanup of debug permalink files.

Asset download routes set `nosniff` and a restrictive content policy.

When upgrading from a deployment with existing uploads, preserve the old `assets/` and `userassets/` collection contents in the new checkout's `/assets` directory before switching traffic. If the old deployment stored profile images in `public/userassets`, copy those files into the new `/assets/userassets/` collection with their original names. Review same-name conflicts before copying; do not overwrite files silently. Verify ownership/read access as the service account and keep a separate backup until profile images and permalink uploads have been checked after cutover.

Profile theme uploads accept JPEG, PNG, GIF, and WebP images up to 7 MiB decoded. Their base64 JSON body is bounded by the 10 MiB profile-update limit; decoding validates the content size, base64 structure, and file signature before persisting the image. The avatar endpoint fetches provider images only from the configured basis-auth issuer origin, rejects redirects, and caps the response at 5 MiB with a five-second timeout.

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
| `BASIS_AUTH_RESOURCE_SECRET`, `BASIS_AUTH_INTERNAL_URL` | Both must be set and the URL must be HTTP(S) | Fatal startup error | Warning; sign-in fails with `14408` until the backchannel is configured |
| `CURRENT_URL_ORIGIN` | Public HTTPS origin with no path, query, fragment, or credentials, or loopback HTTP only while bound to loopback | Fatal startup error | Not enforced |
| `TRUSTED_PROXY_HOPS` | Integer 0–10 | Fatal startup error; warning at 0 | Warning |
| `REQUIRE_VERIFIED_EMAIL` | Truthy enables strict verification | Warning when disabled | No warning |

Resource access tokens are verified against basis-auth JWKS and are never signed by nethack.

## Supply chain and release controls

CI runs `gitleaks` over the repository history and publishes an SPDX SBOM artifact. The release workflow verifies that the tag is an ancestor of `main`, runs dependency audit, type check, lint, the full test suite, and the coverage gate before packaging. Release archives carry a SHA-256 checksum. `.github/dependabot.yml` opens grouped weekly npm updates and monthly documentation, GitHub Actions, and Docker updates. Workflow actions are currently referenced by major tag; pin each to a full commit SHA when bumping because tags are mutable. Production client source maps are disabled so original sources are not shipped.

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

- **`login.get.ts`** — The `redirect` parameter is allowed only when it is a safe relative path; absolute and protocol-relative URLs are rejected.
- **basis-auth callback** — The post-login redirect is re-validated from the encrypted transaction cookie before it is followed.
- **`SafeLink.vue`** — User-provided links in rendered content (e.g. project descriptions) are rendered through the `SafeLink` component, which validates URLs with `isSafeUrl()` — only relative paths rooted at `/` and `http:`/`https:` URLs are rendered as clickable links; unsafe URLs are shown as plain strikethrough text.
- **`SafeComark.vue`** — Markdown content rendered from user input uses the `SafeLink` component as its link renderer via `@comark/vue`, disables the default HTML/component plugins, and preserves single line breaks with the `breaks` plugin.

## Token custody

Access and refresh tokens are sealed with AES-256-GCM into the HTTP-only `basis-auth-tokens` cookie; browser JavaScript cannot read it. `GET /api/auth/session` returns only the user ID, expiry, and permission list for display. Protected APIs validate the token from the cookie or an explicit bearer header, including signature, issuer, audience, expiry, token type, and permissions. Admin impersonation is not supported.

## Role-Based Access Control (RBAC)

- RBAC is enforced **server-side**; the frontend never performs permission checks for authorization.
- `requireUser(event, permission?)` validates the bearer identity, returns the full database user row or `401 Unauthorized`, and enforces the optional permission requirement with `403 Forbidden`.
- Judge and administrator access is expressed as granular permissions such as `nethack.Judging.*` or `nethack.all` and passed to `requireUser`.
- Fine-grained permissions are checked against the verified basis-auth JWT `permissions` array using `NethackPermissions` from `shared/permissions.ts`.
- The local user table contains no authorization role; `nethack.all` is the explicit administrative grant.

::: danger Never trust the frontend for permission checks. Always validate on the server. :::

## Removed integrations

The Microsoft Graph integration, its application/user tokens, and its ROPC credentials were removed. `server/plugins/microsoft.ts` and the webhook validation helpers no longer exist. The legacy `/_webhooks/lifecycle` and `/_webhooks/update` paths remain registered only to return `404`. The legacy `oauth2_applications` table remains as historical data; its hashed client-secret format is no longer used by the running application.

## Validation bypasses that do not exist

The running application has no native OAuth2 authorization, consent, or token endpoint. Browser authentication goes through basis-auth, which owns provider login and consent. There is no local path to issue or upgrade permissions outside the verified basis-auth token and the local administrator flag.

## Resource Access Tokens

Protected nethack APIs accept basis-auth access tokens with the following required properties:

- **Signature:** basis-auth JWKS, RS256 only
- **Issuer:** exact `BASIS_AUTH_ISSUER`
- **Audience:** exact `BASIS_AUTH_RESOURCE`
- **Type:** `at+jwt`
- **Lifetime:** token must be unexpired
- **Claims:** string `sub`, `client_id`, and `scope`
- **Revocation:** the `jti` must not be deny-listed, `iat` must be after the subject's logout barrier, and the private listener must not report the subject as disabled

Token verification uses `jose.jwtVerify()` and a remotely refreshed basis-auth JWKS. The stable `sub` is mapped through `users.auth_issuer` and `users.auth_subject`. Every rejected token returns the same public shape: HTTP `401`, `WWW-Authenticate: Bearer error="invalid_token"`, and the `Invalid access token` description.

## Backchannel Logout

basis-auth requires a verified backchannel logout URL for the resource before authorization-code sign-in works. `POST /api/auth/basis/backchannel` answers the webhook challenge, applies `logout_token` events, and denylists revoked access-token `jti` values. The receiver authenticates to the private listener with `BASIS_AUTH_RESOURCE_SECRET` and signs `HMAC-SHA256(challenge)`; it never trusts unsigned form fields. It is exempt from the browser-origin CSRF check because basis-auth posts it server-to-server without browser headers; the signed proof is its authentication. See [basis-auth Integration](/architecture/oauth2#backchannel-logout-and-revocation).

## PKCE Support

The basis-auth browser flow always generates a fresh verifier and sends an S256 challenge. The verifier, state, and nonce remain only in the encrypted short-lived transaction session, and `openid-client` validates all three during callback processing.

## Sensitive scope consent

Consent for requested scopes belongs to basis-auth. This application requests `openid profile email offline_access` and does not run a local authorization or consent page. The legacy `shared/oauth2-scopes.ts` metadata remains only for historical records and rollback tooling.

---

## XSS Prevention Audit

A comprehensive XSS audit has been performed across all frontend components (`app/` directory, 50+ `.vue`/`.ts` files):

- **No `v-html` usage**: zero instances. All user-controlled text renders through Vue's auto-escaping `{{ }}` interpolation.
- **No `innerHTML`** or `dangerouslySetInnerHTML`: zero instances.
- **SafeLink component**: validates all `href` attributes via `isSafeUrl()` before rendering; unsafe URLs render as inert `<span>` elements.
- **SafeComark component**: renders user project descriptions with the default Comark HTML plugin disabled, then maps links through `SafeLink`.
- **URL safety**: all project demo/repo URLs use `safeUrl()` computed properties; new uploaded objects use server-generated SHA-256 content-addressed filenames.
- **Form maxlength attributes**: all key form inputs (`ProjectForm.vue`, `JudgingCard.vue`, `voting.vue`) now have `:maxlength` bound to the `MAX_*` constants from `shared/schemas.ts`, preventing users from exceeding validation limits before submission.

The review found no direct HTML injection sinks at the time of writing. This is a point-in-time audit, not a guarantee; keep the no-`v-html` rule and rerun the review when adding new render paths.

---

<QuoteCycler />
