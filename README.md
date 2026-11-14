# basishacks

The official website for the **BIBS-C Network Hackathon** (season 2, 2025–26). Full-stack Nuxt 4 application with basis-auth login, peer voting, judge scoring, team management, and independent Graph integration.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Framework | Nuxt 4 |
| UI | @nuxt/ui (Tailwind CSS v4) |
| Language | TypeScript |
| Runtime | Node.js >= v24 (VPS); Bun 1.3.14 is also supported |
| Package Manager | Bun 1.3.14 or npm |
| Database | PostgreSQL via Drizzle ORM (`postgres` driver) |
| Auth | basis-auth OIDC with encrypted HTTP-only token cookies |
| OIDC | openid-client + jose |
| Validation | Zod 4.x |
| Fonts | @nuxt/fonts (local provider) |
| Icons | `@nuxt/icon` + `@iconify-json` (fluent, heroicons, lucide, material-symbols, simple-icons) |
| Linting | @nuxt/eslint + Oxfmt |
| Animation | GSAP with ScrollTrigger (showcase pages) |

## Season Showcases

The public `/showcase` page collects the season showcases in one place. The current featured experience, Beneath the Surface, lives at `/showcase/beneath-the-surface`; the previous Signal experience lives at `/showcase/signal`. Beneath the Surface loads archived project metadata from `/api/teams?season_id=1` and presents the top three Junior and top three Senior projects as six full-screen, project-specific chapters. GSAP and ScrollTrigger provide the desktop scroll choreography, while mobile and reduced-motion visitors receive a natural, non-pinned reading experience.

## Prerequisites

- **Node.js** >= v24 for the primary VPS runtime; **Bun** v1.3.14 is also supported
- Install dependencies with Bun 1.3.14 or npm
- A PostgreSQL database reachable through `DATABASE_URL`

## Installation

Clone [`@basis/schema`](https://github.com/biszdevelopers/basis-schema) beside this repository. Nuxt and Vitest resolve its source through local aliases; no Bun link is required.

```bash
git clone https://github.com/biszdevelopers/basis-schema.git ../basis-schema
bun install
```

If both repositories already exist in the same parent directory, run `bun install`. The `postinstall` script generates the server icon bundle and Nuxt's typed references when development icon collections are installed. Production-only installs skip source preparation and use the already-built Nuxt output.

## Environment Setup

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

The canonical list of variables lives in `.env.example`. The table below summarizes which are required and which are optional.

| Variable | Required? | Purpose |
| --- | --- | --- |
| `BASIS_AUTH_COOKIE_SECRET` | Required | Session and token-record encryption key. Must be at least 32 bytes. Generate with `openssl rand -base64 32` |
| `BASIS_AUTH_ISSUER` | Required | Exact basis-auth issuer URL used for discovery and token validation |
| `BASIS_AUTH_CLIENT_ID` | Required | Confidential client ID registered for basishacks |
| `BASIS_AUTH_CLIENT_SECRET` | Required | Confidential client secret; keep it server-side |
| `BASIS_AUTH_RESOURCE` | Required | Resource audience for basishacks access tokens (`devconnect://nethack.bisz.dev`) |
| `DATABASE_URL` | Required | PostgreSQL connection URL used in development, CI, and production |
| `DATABASE_POOL_MAX` | Optional | Connection pool maximum (default `10`, accepted range `2`–`64`) |
| `DATABASE_METRICS` | Optional | Set to `1` to log bounded PostgreSQL query and pool-acquisition timing summaries once per minute |
| `MICROSOFT_TENANT_ID` | Optional | Tenant used only by Graph features |
| `MICROSOFT_CLIENT_ID` | Optional | Application ID used only by Graph features |
| `MICROSOFT_CLIENT_SECRET` | Optional | Application secret used only by Graph features |
| `MICROSOFT_WEBHOOK_STATE` | Optional | Persistent secret (at least 32 bytes) used to validate Graph webhook notifications |
| `MICROSOFT_WEBHOOK_ID` | Optional | Existing Graph webhook subscription ID; set after the first subscription is created so restarts refresh it |
| `CURRENT_URL_ORIGIN` | Required in production | Public HTTPS origin used to derive `/api/auth/basis/callback` and validate cookie-authenticated mutations. Use `http://localhost:3000` for local development |
| `DEEPSEEK_API_KEY` | Optional | DeepSeek API key for AI chat features (debug routes only) |
| `PORT` / `HOST` | Optional | Server port/host override (defaults: `3000` / `0.0.0.0`) |
| `SQLITE_IMPORT_PATH` | Optional | SQLite backup path used only for the one-time SQLite-to-PostgreSQL import |
| `RATE_LIMIT_GENERAL_MAX` | Optional | General API rate limit, requests per minute (default: `120`) |
| `RATE_LIMIT_AUTH_MAX` | Optional | Authentication endpoint rate limit, attempts per minute (default: `20`) |
| `RATE_LIMIT_VOTE_MAX` | Optional | Voting/scoring endpoint rate limit, submissions per minute (default: `30`) |
| `RATE_LIMIT_UPLOAD_MAX` | Optional | File upload endpoint rate limit, uploads per minute (default: `10`) |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate limit window in milliseconds (default: `60000`) |
| `TRUSTED_PROXY_HOPS` | Optional | Exact trusted proxy count (0–10); configure only when each proxy appends the actual peer address to `X-Forwarded-For` |
| `DISABLE_DEBUG_ROUTES` | Optional | Set to a truthy value to disable `/api/debug/*` and `/debug` outside production; production disables them automatically |

## Authentication

The only login method is the separately deployed **basis-auth** service. `/api/login` discovers the issuer and starts an authorization-code flow with S256 PKCE, state, and nonce. The callback URL is always `${CURRENT_URL_ORIGIN}/api/auth/basis/callback`; it must be registered exactly for each environment. Resource-token claims and delegated permissions use the shared `@basis/schema` package; hackathon participant, judge, and administrator roles remain local.

The authorization request targets `devconnect://nethack.bisz.dev` and requests `openid profile email offline_access nethack.access`. Feature authorization is not represented by OAuth scopes: basis-auth supplies a JWT `permissions` array, and basishacks checks the least-privilege `nethack.*` permission required by each protected route. `nethack.all` is the explicit administrative grant. During the role-to-permission migration, legacy `participant`, `judge`, and `admin` grants are expanded into their equivalent granular permissions at the authorization boundary. After validating the ID token and UserInfo, basishacks links the identity and seals the access and refresh tokens into a compressed AES-256-GCM HTTP-only cookie. Browser JavaScript cannot read the token cookie. `GET /api/auth/session` validates the access token and returns only the user ID, expiry, and permissions for display-only UI gating; protected APIs independently validate either the cookie-held token or an explicit bearer token. When the access token nears expiry, the server rotates tokens and reseals the cookie. `POST /api/auth/logout` attempts refresh-token revocation and always clears the browser credential.

Protected application APIs validate basis-auth RS256 access tokens from the encrypted HTTP-only token cookie or an explicit `Authorization: Bearer …` header. The separate browser session cookie alone is insufficient. Tokens must match the configured issuer and resource audience; JWT permissions are the authorization source. Failed requests use `Accept` negotiation: clients accepting `text/html` receive the shared Barry error page showing only the canonical error code, while other clients receive the `@basis/schema` JSON envelope `{ status, code, error, error_description }` with matching HTTP and envelope status values.

The former basishacks OAuth provider and application-management UI/API have been retired. The legacy `oauth2_applications` table and records remain for audit and rollback. Graph integration is independent and is never used to authenticate a basishacks session.

## Database Setup

The PostgreSQL database auto-migrates on server startup. The init plugin `server/plugins/init-database.ts` creates the bounded `postgres` connection pool and applies Drizzle migrations under a PostgreSQL advisory lock before the server accepts requests. It then seeds the default event, season, and rubric; generated season IDs use the PostgreSQL serial sequence, and `seasons.rubric_version_id` is protected by a foreign key. Configure a valid `DATABASE_URL` in every environment. The default pool maximum is 10 connections; `DATABASE_POOL_MAX` accepts validated values from 2 to 64.

Application queries use Drizzle ORM's parameterized query builders. `bun run db:migrate` applies pending PostgreSQL migrations for release workflows; server startup also applies pending migrations before serving.

For manual schema management (e.g., generating migration files after editing `server/database/schema.ts`), Drizzle Kit is available:

```bash
bun run db:migrate    # apply pending PostgreSQL migrations
bun run db:generate   # generate new migration from schema changes
bun run db:studio     # open Drizzle Studio
```

### Importing an existing SQLite database

SQLite files are not used by the application at runtime. To migrate an existing deployment, take and verify a SQLite backup, provision a new PostgreSQL database, stop the app, apply migrations, then run the one-time importer. The importer accepts an empty target or the complete exact seed from fresh migrations; it rejects partial or modified seed rows and other target data. It preserves IDs and relationships, normalizes safe epoch timestamps stored with a zero fraction, maps nullable legacy sourcing text to an empty value, imports legacy `sc_votes`, adds an immutable imported rubric version per season, archives removed legacy fields, checks foreign-key relationships and row counts, and rolls back the entire import on failure. The earlier single-hackathon schema is mapped to one explicit season; retired one-time login credentials are discarded. Unknown non-metadata tables and broken source references fail closed; the importer reads the SQLite source without modifying it. See [SQLite-to-PostgreSQL migration](documentation/deployment/postgresql-migration.md) for the maintenance-window procedure.

## Judging and Published Feedback

Judges score one project at a time against the season's versioned rubric while the event is in the `voting` phase and the organizer has enabled `judging_open`. Drafts save automatically, and the judge reviews the evaluation before final submission. Finalized scores use the arithmetic mean of each judge's normalized weighted rubric score. After results are published, current and past team members can read anonymous written feedback once at least three judges have evaluated their team; before then, the interface explains the anonymity gate without exposing an exact review count. Individual judge score breakdowns and identifiers are omitted, and feedback order is randomized. Public score and rank details also stay hidden until at least three judges have evaluated the team; scores additionally require `show_scores`, and ranks require `show_ranking`. Administrators can inspect full evaluations with judge identities.

Each immutable rubric version also stores its own judge-comment introduction, guidelines, and editable prompt templates. Organizers can configure these in the season rubric editor; copying a prior-season rubric or reusable template carries its guidance forward. Legacy rubric versions use the built-in defaults. Final submission rejects a comment containing the judge's exact email address or display name, with an inline correction message; this conservative check does not identify indirect clues or alternate spellings.

Draft reads, autosaves, and deletes share a separate per-judge limit of 120 requests per minute by default. This uses `RATE_LIMIT_GENERAL_MAX` and `RATE_LIMIT_WINDOW_MS`, leaving headroom for the 650 ms autosave debounce.

Organizers can choose a season-specific score display curve (`original`, `gentle`, `moderate`, or `strong`). A curve changes only the displayed score: persisted scores and rankings remain unchanged. The admin team view can inspect full score feedback with judge identities before or after results are published.

Team score cards link to `/seasons/:id`, where participants and organizers can review that team's season schedule and theme. Future and paused season themes remain hidden until the event begins.

## Development

```bash
bun dev --https        # HTTPS on port 24598
npm run dev -- --https # or with npm
```

For HTTP (not recommended — OAuth2 requires secure context): `bun dev`

The custom Nitro error-handler path is normalized to forward slashes in `nuxt.config.ts`. This keeps the generated virtual module valid on Windows, including when the absolute project path contains digit-leading username segments that JavaScript could otherwise parse as legacy octal escapes.

## Testing

```bash
bun run test            # full suite (also generates tests/.test-meta.json)
bun run test:watch      # watch mode
bun run test:coverage   # enforce 100% executable source coverage
bun run test:e2e:oidc   # protocol and security tests for the isolated test issuer
bun run build
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/basishacks_e2e"
bun run test:e2e        # Chromium role and responsive browser journeys
```

The canonical test count is stored in `tests/.test-meta.json` and displayed dynamically in the VitePress documentation. Coverage enforces 100% statements, branches, functions, and lines for instrumented `.js`, `.mjs`, and `.ts` files under `app/`, `server/`, `shared/`, and `scripts/`, plus the production launcher and Drizzle config. It verifies per-file counters and merges the client and server builds for compile-time branches. Vue single-file components and CSS are not runtime-instrumented; source-contract checks do not replace rendered browser journeys or viewport accessibility checks.

Browser tests require a production build, Chromium installed for Playwright, and a dedicated PostgreSQL database whose name ends in `_e2e`. The harness refuses other database names, starts the built app and an isolated OIDC issuer on loopback, and never adds a production test-login route. CI creates the isolated database and installs Chromium on its temporary runner.

Do **not** use `bun test` — it cannot resolve Nuxt path aliases. `bunfig.toml` redirects it to a guidance shim.

## Performance Measurement

The Linux benchmark harness at `scripts/benchmark-vps.mjs` reports process RSS, service cgroup memory, request throughput, per-target p50/p95/p99 latency, errors, CPU use, and PostgreSQL query/pool timings. Load runs require cgroup and database-metrics inputs so the release gate cannot silently skip those measurements. Set `DATABASE_METRICS=1` on the app service to emit bounded timing summaries. Follow the [VPS measurement workflow](documentation/deployment/performance.md) for the five-minute warm-up and idle runs, repeated cold starts, 250-user soak, and `main` baseline comparison; Linux measurements remain a release gate.

## Building & Production

```bash
git clone <repository-url> /opt/basishacks/current
cd /opt/basishacks/current
bun install --frozen-lockfile
# Configure required production environment variables before starting.
bun run build
bun run db:migrate
bun run start
# On Linux VPS hosts, `npm run start` uses the same POSIX runtime selector.
# It prefers Bun 1.3.14 and falls back to Node.js 24 or newer.
# To explicitly use Node.js after building the same checkout:
node start-fix.mjs
```

Keep the same checkout for `git pull`, build, and start so its ignored `/assets` upload directory persists. The optional release-packaging workflow is still available for archive-based deployments; when replacing a checkout, preserve or restore `/assets` first. Both Bun and Node.js run the same generated server.

Place a reverse proxy (Nginx, Caddy) in front for TLS termination. Keep PostgreSQL data separately persistent. Runtime uploads live in the project-root `/assets` directory, which is gitignored: in-place `git pull`, build, and start deployments preserve it. Back it up separately, and preserve or restore it before serving after a re-clone. The committed showcase files in `public/assets` are separate from runtime uploads. Hardened systemd examples for either runtime are available under [`deploy/systemd/`](deploy/systemd/).

For Nginx, include [`deploy/nginx/basishacks-request-limits.conf`](deploy/nginx/basishacks-request-limits.conf) inside the application site's `server {}` block. The app caps ordinary API request bodies at 1 MiB, lets the authorized profile handler read up to 10 MiB for profile updates, and processes at most one profile update at a time per app process before buffering or decoding images. Additional simultaneous profile updates receive `503 Service Unavailable` with `Retry-After: 2`. Graph webhook JSON is streamed through a 64 KiB limit, and webhook batches are rejected when the configured state is unset. Multipart uploads have their own streamed file-size and overhead limits.

Uploads are stored in project-root `/assets` under the `assets` and `userassets` collections; the static showcase under `public/assets` is not part of this storage. Profile images use SHA-256 content-addressed names under `/assets/userassets/profiles/`, so identical image bytes with the same canonical extension share one object. Cleanup considers managed profile objects after at least seven days and removes one only after an advisory-locked PostgreSQL check confirms there are no profile-picture, profile-theme, or legacy OAuth application picture references. New debug permalinks are content-addressed and registered in `asset_objects` and `asset_references`; each upload gets an owner-managed reference that remains active until its owner or an admin releases it. Users can list their own active references, while admins can list all references. After the last reference is released, cleanup waits seven days and rechecks references under the same advisory lock before deleting the file. Cleanup runs daily and is bounded per run. Existing or otherwise unknown files, including legacy non-hashed uploads and unregistered content-addressed files, remain pinned and are never automatically deleted. Multipart uploads are streamed with size and content checks; cookie-authenticated uploads require a same-origin request.

## Deployment

1. Build on the server: `bun run build`
2. Set all required environment variables in the server environment
3. Start with `bun run start` or, on Linux, `npm run start` (selects Bun 1.3.14 when available, otherwise Node.js 24 or newer), or use `node start-fix.mjs` to explicitly choose Node.js
4. Reverse proxy with TLS in front (port defaults to `3000`)

### GitHub tag releases

Pushing a tag beginning with `v` runs `.github/workflows/release.yml`. It builds a VPS artifact with the Nuxt server, portable runtime dependency paths, PostgreSQL migrations, migration/import commands, and production dependencies installed from the lockfile. The workflow verifies the extracted archive under Node.js and Bun against PostgreSQL. The recommended VPS flow is to keep a direct checkout and run `bun run build` followed by `bun run start`. If using the optional release archive, preserve or restore project-root `/assets` before serving; back it up separately from PostgreSQL. The committed showcase files in `public/assets` remain separate from runtime uploads.

## Project Structure

```
app/                    # Vue frontend
server/                 # Nitro backend
  api/                  # API route handlers
  middleware/           # Database context, request limits, CSRF and security headers
  plugins/              # DB initialization, Graph integration, env validation
  database/             # PostgreSQL Drizzle ORM schema + migration runner
  utils/                # Auth, rate limiting, OAuth2 JWT, URL validation, etc.
shared/                 # Zod schemas, types, permissions, OAuth2 scopes, rubric
tests/                  # Vitest suite
documentation/          # VitePress site
```

## Existing SQLite deployment

For an existing deployment with a SQLite database, follow the [SQLite-to-PostgreSQL migration procedure](documentation/deployment/postgresql-migration.md). The app no longer reads SQLite at runtime; the SQLite file must be imported into PostgreSQL before starting the new release.

### Required authentication env vars

Set `BASIS_AUTH_ISSUER`, `BASIS_AUTH_CLIENT_ID`, `BASIS_AUTH_CLIENT_SECRET`, and `BASIS_AUTH_RESOURCE` in `.env`. Register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` with the same basis-auth client.
