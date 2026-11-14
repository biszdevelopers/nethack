---
title: Runtime Architecture
description: How basishacks runs in local development versus production, including database initialization, Nitro plugins, and event context augmentations.
---

# Runtime Architecture

basishacks runs on PostgreSQL in local development, CI, and production. The Bun and Node.js processes share the same PostgreSQL schema and use Drizzle ORM with the `postgres` driver; no runtime-specific database adapter is selected.

## Local Development

| Setting         | Value                                     |
| --------------- | ----------------------------------------- |
| Nitro preset    | `node-server`                             |
| Database        | PostgreSQL via Drizzle ORM and `postgres` |
| Connection pool | Bounded; default maximum 10 connections   |
| Migrations      | Applied under a PostgreSQL advisory lock  |
| Dev server port | 24598                                     |
| HTTPS           | Optional (`--https` flag)                 |

The local dev server is started with:

```bash
bun dev --https
```

The custom server error handler is configured with a forward-slash-normalized absolute path. Nitro embeds this path in a generated virtual ES module, so normalization prevents Windows backslashes from becoming JavaScript escape sequences (for example, an octal-looking sequence in a numeric user profile directory).

## Production (VPS / Node.js server)

| Setting      | Value                                     |
| ------------ | ----------------------------------------- |
| Build preset | `node-server`                             |
| Database     | PostgreSQL via Drizzle ORM and `postgres` |
| Deployment   | Manual or CI/CD to VPS                    |

The production build is generated with:

```bash
bun run build
```

Nitro leaves runtime dependencies external so its generated bundles resolve them from the deployed `node_modules` directory. Deploy with production dependencies and configure `DATABASE_URL`. Runtime uploads are stored under the project-root `/assets` directory, which is gitignored and must be writable by the service account. In-place pull/build/start updates preserve this directory; a re-clone or fresh checkout must preserve or restore it before serving. Back up uploads separately. `public/assets` contains committed showcase files and is separate from runtime storage. The same build runs with `bun run start` or, on Linux, `npm run start`, selecting Bun 1.3.14 when present and Node.js 24 or newer otherwise. Run `node start-fix.mjs` to explicitly select Node.js.

::: warning The in-memory rate limiter is per-process. Under high concurrency or with multiple server instances, consider using a shared store (e.g., Redis) for consistent rate limiting. :::

## Drizzle ORM

The database layer uses Drizzle ORM (`server/database/`) for type-safe queries.

## Nitro Plugins

Plugins run at server startup and set up the runtime environment. They are loaded in alphabetical order.

### `init-database.ts`

**Purpose**: Initializes and migrates the database before serving requests, then closes the pool during shutdown.

1. Calls `createDrizzleDatabase()` to create the bounded PostgreSQL connection pool
2. Applies pending PostgreSQL migrations while holding an advisory lock
3. Seeds the initial hackathon, season, and default rubric records when they are missing
4. Closes the pool through Nitro's `close` hook

### `02.database.ts`

**File:** `server/middleware/02.database.ts`

Attaches the initialized process-wide Drizzle instance to `event.context.drizzle` before each request reaches a route handler.

### `validate-environment.ts`

**Purpose**: Validates the encrypted-session password and the four required basis-auth client variables. Missing basis-auth configuration is fatal in production and produces a warning in development.

### `microsoft.ts`

**Purpose**: Initializes and manages Microsoft Graph API access tokens.

1. On startup, fetches an app-level access token using client credentials flow
2. Provides `requestMicrosoft()` and `requestUserMicrosoft()` wrappers for Graph API calls
3. Exports higher-level functions such as `createMicrosoftMeeting()` and `createOrGetExistingDirectChat()`
4. Caches direct chat IDs in-memory to avoid repeated Graph API lookups

::: warning All Microsoft Graph API calls **must** be made through functions exported from this plugin. This is a security policy to ensure auditability of all external API calls. :::

## Event Context Augmentations

The H3 event context is extended via TypeScript declarations in `server/types/`:

### `h3.d.ts`

**File:** `server/types/h3.d.ts`

```ts
declare module "h3" {
    interface H3EventContext {
        /** Process-wide PostgreSQL Drizzle instance */
        drizzle: DrizzleDatabase;
    }
}
```

### `oauth2-jwt.d.ts`

```ts
declare module "h3" {
    interface H3EventContext {
        oauth2?: OAuth2JWTContext;
    }
}
```

### Context availability

| Key | Type | Always present? | Set by |
| --- | --- | --- | --- |
| `event.context.drizzle` | `DrizzleDatabase` | Yes | `02.database.ts` request middleware |
| `event.context.oauth2` | `OAuth2JWTContext` | Only in OAuth2-protected endpoints | `withOAuth2JWT()` wrapper |

## Request Lifecycle

```
1. Incoming HTTP request
     │
2. Ordered server middleware
     ├── Enforces same-origin mutation and request-size limits
     └── Attaches the shared Drizzle instance to the request context
     │
3. API route handler
     │  ├── readValidatedBody() / getValidatedQuery() with Zod
     │  ├── requireUser() JWT permission enforcement
     │  └── event.context.drizzle.select()/insert()/update()/delete()
     │
4. Response
     └── convertUserToPublic() / convertTeamToPublic() to strip internal fields
```
