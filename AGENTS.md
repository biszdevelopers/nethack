# AGENTS.md — basishacks

This file contains project-specific context for AI coding agents. The reader is assumed to know nothing about the codebase.

---

## Project Overview

`basishacks` is the official website for the BIBS-C Network Hackathon (season 2, 2025–26). It is a full-stack Nuxt 4 application that manages:

- Hackathon registration and scheduling
- Team creation and management
- Project submission (name, description, demo URL, repo URL)
- Peer voting and judge scoring
- basis-auth login and resource-token integration

The stack is Vue 3 (frontend) + Nitro (backend) + PostgreSQL via Drizzle ORM and the `postgres` driver. Bun 1.3.14 and Node.js use the same database implementation.

---

## Technology Stack

| Layer | Technology |
| --- | --- |
| Framework | Nuxt 4 (^4.6.4) |
| UI | `@nuxt/ui` ^4.12.0 (Tailwind CSS v4 based) |
| Language | TypeScript (^6.0.3) |
| Runtime | Node.js >= v24 or Bun 1.3.14 (dual-runtime support) |
| Package Manager | Bun 1.3.14 or npm |
| Database | PostgreSQL via Drizzle ORM and `postgres` |
| Auth | basis-auth OpenID Connect with encrypted HTTP-only token cookies |
| Validation | Zod 4.x (^4.6.7) |
| Fonts | `@nuxt/fonts` ^0.14.0 (local provider) |
| Icons | `@nuxt/icon` with `@iconify-json` (fluent, heroicons, lucide, material-symbols, simple-icons) |
| Linting | `@nuxt/eslint` + Oxfmt ^0.78.0 |
| Deployment | Node.js server (VPS; Bun also supported) |

---

## Directory Structure

```
app/                # Nuxt app (Vue frontend)
  assets/css/       # Global styles (Tailwind + custom utilities)
  components/       # Vue components
  layouts/          # Nuxt layouts (default, dashboard, fullwidth, etc.)
  middleware/       # Route middleware (auth.ts)
  pages/            # File-based routing
  utils/            # Frontend utilities (consts, errors, loading)

server/             # Nitro backend
  api/              # API route handlers (file-based)
  middleware/       # Server middleware (OAuth2 authorize)
  plugins/          # Nitro plugins (DB init, Graph integration, environment validation)
  database/         # Drizzle ORM schema, PostgreSQL connection, and migrations
    schema.ts       # Canonical Drizzle schema
    migrate.ts      # Advisory-locked PostgreSQL migration and seed runner
    index.ts        # Bounded PostgreSQL pool shared by Bun and Node.js
  types/            # Type augmentations (H3EventContext)
  utils/            # Server utilities
    database/       # Per-table Drizzle helpers
    auth.ts         # requireUser / requireJudge / requireAdmin
    convert.ts      # DB row -> public API object transformers
    rateLimit.ts    # In-memory rate limiter
    oauth2.ts       # OAuth2 logic
    profile.ts      # Profile picture helpers
    assets.ts       # Asset helpers
    deepseek-store.ts

shared/             # Code shared between client and server
  schemas.ts        # Zod schemas for API input validation
  database.d.ts     # TypeScript types matching DB schema exactly
  responses.d.ts    # API response interface definitions
  auth.d.ts         # basis-auth session type augmentation
  permissions.ts    # Fine-grained permission constants and helpers
  oauth2-scopes.ts  # OAuth2 scope definitions
  rubric.ts         # Judging rubric definitions

sql/archive/        # Archived legacy SQL schema and migrations
  init.sql          # Historical base schema
  migration-*.sql   # Historical dated migrations
  patch-*.sql       # Historical feature patches

drizzle/            # Drizzle Kit generated migration files
  *.sql             # Migration SQL
  meta/             # Drizzle Kit metadata snapshots

tests/              # Vitest test suite
  **/*.test.ts      # API, server utility, shared, component, page, etc.
  setup.ts          # Global test setup, in-memory DB, mocks

bun-shim/           # Compatibility shim for `bun test`
  shim.test.ts      # Prints guidance to use `bun run test`

drizzle/postgres/   # PostgreSQL migrations and Drizzle Kit metadata
```

---

## Build & Development Commands

```bash
# Install dependencies
bun i

# PostgreSQL auto-migrates on server startup; manual Drizzle Kit command
bun run db:migrate

# Dev server (HTTPS, port 24598)
bun dev --https
# or
npm run dev -- --https

# Production build
bun run build

# Preview built app
bun run preview   # port 24598

# Run tests (Vitest; do NOT use `bun test`)
bun run test
```

---

## Runtime Architecture

### Local Development and Production (VPS)

- Nitro preset: `node-server`.
- Both runtimes require `DATABASE_URL` and use the same PostgreSQL driver.
- `DATABASE_POOL_MAX` defaults to 10 and accepts validated values from 2 through 64.
- `server/plugins/init-database.ts` creates the pool, applies advisory-locked migrations, seeds initial rows, and closes the pool during shutdown.
- `server/middleware/02.database.ts` attaches the shared Drizzle instance to each request as `event.context.drizzle`.
- User uploads are stored under `ASSET_STORAGE_DIR`, outside the release directory.

---

## Auth & Roles

Authentication is delegated to the separately deployed **basis-auth** OpenID Connect service. The login flow uses discovery, authorization code with S256 PKCE, state, nonce, a confidential client secret, validated ID tokens, and UserInfo.

Graph integration is independent from login and must never create or authenticate a basishacks session.

The encrypted HTTP-only cookie stores the validated basis-auth tokens and user identity. Session and role checks are enforced server-side through the helpers below.

Roles:

- `participant`
- `judge`
- `admin`

Use the helpers in `server/utils/auth.ts` to enforce roles:

- `requireUser(event)` — returns the full DB user row or 401
- `requireJudge(event)` — 403 if not judge/admin
- `requireAdmin(event)` — 403 if not admin

---

## Database Conventions

- All DB access goes through `event.context.drizzle` (Drizzle ORM).
- Per-table helpers live in `server/utils/database/*.ts` (e.g., `users.ts`, `teams.ts`).
- The canonical TypeScript types are in `shared/database.d.ts` (inferred from Drizzle schema).
- PostgreSQL migration files are generated by Drizzle Kit and stored in `drizzle/postgres/`; startup applies them under an advisory lock through `server/database/migrate.ts`.
- Profile themes are stored as `"mode|value"` strings in the DB and parsed into `{ mode, value }` objects in the API layer (`server/utils/convert.ts`).

---

## API Patterns

- Route files use Nuxt/Nitro file-based naming: `server/api/teams/index.post.ts`.
- Input validation is mandatory; use `readValidatedBody(event, Schema.parse)` or `getValidatedQuery(event, Schema.parse)`.
- Shared Zod schemas are in `shared/schemas.ts`.
- API responses should match the interfaces in `shared/responses.d.ts`.
- Use `convertUserToPublic` and `convertTeamToPublic` to strip internal fields before returning data.
- Rate limiting is applied with `applyRateLimit(handler)` from `server/utils/rateLimit.ts` (default: 120 requests/minute). See `RATE_LIMITING.md` for usage.

---

## Frontend Patterns

- Pages use `<script setup lang="ts">`.
- Global constants (`WEBSITE_NAME`, `THEME_NAME`) are imported from `~/utils/consts.ts`.
- Fetch errors are handled with `getErrorMessage(e)` from `~/utils/errors.ts`.
- The `auth` route middleware (`app/middleware/auth.ts`) redirects unauthenticated users to `/login`.
- Layouts are declared with `definePageMeta({ layout: '...' })`.
- UI components come from `@nuxt/ui` (e.g., `UButton`, `UForm`, `UAlert`).
- Run `bun run format` always before you commit

---

## Code Style

- Oxfmt config (`.oxfmtrc.json`): **semicolons enabled**, **double quotes**, `tabWidth: 4`, `trailingComma: all`, `printWidth: 100`.
- ESLint is configured via `@nuxt/eslint` (`eslint.config.mjs`).
- Prefer `const` and arrow functions where appropriate.
- Use `~~/` for imports from the project root (especially in server code).

---

## Testing

Tests are run with **Vitest**:

```bash
bun run test            # one-shot run
bun run test:watch      # watch mode
bun run test:coverage   # with coverage
```

The authoritative test count is recorded in `tests/.test-meta.json`, which `bun run test` refreshes. Tests cover API endpoints, server utilities, database helpers, shared schemas, frontend components, pages, composables, and middleware. Most isolated API and database-helper tests still use in-memory SQLite fixtures; the PostgreSQL integration test separately validates migrations, JSON storage, and database constraints against a configured PostgreSQL service.

Do **not** use `bun test`. Bun's native test runner cannot resolve Nuxt's `~~/` and `~/` path aliases. `bunfig.toml` redirects `bun test` to `bun-shim/shim.test.ts`, which prints guidance pointing to `bun run test`.

Legacy files such as `tests/index.js`, `tests/test.oauth2.js`, and `tests/test.deepseek.ts` are kept for reference but are not part of the active Vitest suite.

---

## Security Considerations

- **Rate limiting** is in-memory and per-process. Under high concurrency or with multiple server instances, consider using a shared store (e.g., Redis).
- **Cookie encryption secret** (`BASIS_AUTH_COOKIE_SECRET`) must be at least 32 bytes.
- **Foreign keys** are enforced by PostgreSQL constraints.
- **Input validation** is performed with Zod on every API endpoint.
- **RBAC** is enforced server-side; never trust the frontend for permission checks.
- **Graph API** calls are centralized in `server/plugins/microsoft.ts` for auditability and are not used for login.

---

## Deployment

The application is deployed as a Node.js server on a VPS:

```bash
# Build for production
bun run build

# Start the server with Bun 1.3.14
bun run start

# Or use the supported Node.js production launcher
node start-fix.mjs
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in at least the required values:

### Required

| Variable                   | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `BASIS_AUTH_COOKIE_SECRET` | Cookie encryption key (>= 32 bytes)                      |
| `DATABASE_URL`             | PostgreSQL connection URL for development and production |
| `BASIS_AUTH_ISSUER`        | Exact basis-auth issuer URL                              |
| `BASIS_AUTH_CLIENT_ID`     | Confidential basis-auth client ID for basishacks         |
| `BASIS_AUTH_CLIENT_SECRET` | Confidential basis-auth client secret                    |
| `BASIS_AUTH_RESOURCE`      | Required resource audience for basishacks access tokens  |

`DATABASE_POOL_MAX` (default 10, range 2–64) and `ASSET_STORAGE_DIR` are optional deployment settings.

### Optional (for Graph features)

| Variable                  | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `MICROSOFT_TENANT_ID`     | Tenant ID used only for Graph API access          |
| `MICROSOFT_CLIENT_ID`     | Application ID used only for Graph API access     |
| `MICROSOFT_CLIENT_SECRET` | Application secret used only for Graph API access |

### Optional (for development)

| Variable | Purpose |
| --- | --- |
| `CURRENT_URL_ORIGIN` | Public basishacks origin used to derive `/api/auth/basis/callback` (default `http://localhost:3000`) |
| `DEEPSEEK_API_KEY` | DeepSeek API key for AI chat features |
| `PORT` / `HOST` | Server port/host override (defaults: `3000` / `0.0.0.0`) |

In production, these are configured in the server environment.

---

## Useful Notes

- The `hackathon` table has a single row (`id = 1`) that controls the global event state (`not_started`, `in_progress`, `voting`, `finished`, `paused`).
- Each `seasons` row stores its own copy of the tweakable settings (`status`, `show_scores`, `show_ranking` — see `SEASON_TWEAK_FIELDS` in `server/utils/database/seasons.ts`). Editing tweaks via `PATCH /api/seasons/:id/tweaks` also updates the `hackathon` row when the season is live; `setActiveSeason` copies the newly active season's tweaks into the `hackathon` row.
- Team project submissions are only accepted while the hackathon status is `not_started` or `in_progress`.
- Peer voting scores must sum to exactly 10.
- Judge scoring uses the season's immutable rubric version, integer criteria ranges, and weights totaling 100 per track. Weighted normalized criteria are averaged to 0–100; the original score is retained when a display curve is applied.
- Judge drafts can be resumed before finalization. Competitor comments are anonymous and become visible after results are published.
- The `/api/debug/*` routes expose DeepSeek chat sessions and file upload utilities; these are intended for development only.

---

## Documentation Maintenance

**This is a mandatory step.** Before ending every request or finalizing any plan or whenever possible, you MUST:

1. **Update `README.md`** — If your changes affect any feature, configuration, command, or behavior described in the README, update the relevant sections to reflect the current state of the project.

2. **Update VitePress documentation whenever you apply a change (whenever possible)** — If your changes affect any area documented in the `documentation/` directory, update the corresponding pages:
    - `documentation/guide/` — Getting started, project overview, environment setup
    - `documentation/architecture/` — Overview, runtime, database, auth, OAuth2
    - `documentation/frontend/` — Components, pages, layouts, composables
    - `documentation/backend/` — API reference, server utilities, plugins & middleware
    - `documentation/shared/` — Schemas, types, rubric, permissions, OAuth2 scopes
    - `documentation/deployment/` — Deployment, security, rate limiting

    If no existing page covers the changed area, add a new page and register it in `documentation/.vitepress/config.ts` sidebar.

3. **Verify the documentation builds** — Run `cd documentation && npm run build` to confirm no broken links or build errors.

Do not mark a task as complete until the above steps are done.
