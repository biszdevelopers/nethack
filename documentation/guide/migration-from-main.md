---
title: Migration from main
description: Historical migration notes for the enhance-and-debloat branch and current repository state.
---

# Migration from main

::: info Historical Context The `enhance-and-debloat` branch was a PIN-to-PIN compatible upgrade from the original `main` branch. Its changes have since been merged into the current default branch, so the migration steps below are preserved for historical reference only. New clones should follow [Getting Started](/guide/getting-started). :::

## Fresh clone path

If you are starting from a clean checkout:

```bash
# Clone the repository
git clone <repository-url> basishacks-r2
cd basishacks-r2

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env and fill in the required values (see below)

# Build and test
bun run build
bun run test

# Start the server
bun run start      # Uses Bun 1.3.14 when available; otherwise Node.js
# or
npm run start      # Same runtime selector
# or
node start-fix.mjs # Explicitly uses Node.js
```

## Existing-database upgrade path

If you have an existing SQLite database from the original `main` branch, do not start the new app against it. The application now requires PostgreSQL. Follow the [PostgreSQL migration procedure](/deployment/postgresql-migration) to import a verified SQLite backup. The old automatic SQLite schema repair steps below are historical and do not apply to current releases.

For historical reference, the previous SQLite upgrade path was:

1. **Back up the database** (recommended):

    ```bash
    cp database/basishacks.sqlite database/basishacks.sqlite.bak
    ```

2. **Start the server** — the `init-database.ts` plugin automatically:
    - Applies pending Drizzle migrations
    - Runs `migrateLegacySchema()` to add any missing tables (`seasons`, `team_awards`, `peer_voting_scores`, `user_past_teams`) and columns, and converts legacy award catalogs to namespace-keyed rows
    - Preserves all existing data

3. **Verify startup** — check the server logs for:
    ```
    [Nitro] Database plugin loaded with N tables
    Listening on http://[::]:3000
    ```

No manual SQL intervention is required.

## New required environment variables

Login is now delegated to basis-auth. Add the registered confidential-client values to `.env`:

| Variable                   | Purpose                         | Previously hardcoded as         |
| -------------------------- | ------------------------------- | ------------------------------- |
| `BASIS_AUTH_ISSUER`        | Exact basis-auth issuer         | Provider deployment URL         |
| `BASIS_AUTH_CLIENT_ID`     | Registered basishacks client ID | Provider-generated value        |
| `BASIS_AUTH_CLIENT_SECRET` | Confidential client secret      | Provider-generated value        |
| `BASIS_AUTH_RESOURCE`      | basishacks resource audience    | `devconnect://nethack.bisz.dev` |

Register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` in basis-auth.

See [Environment Setup](/guide/environment-setup) for the complete list.

## Test command change

The canonical test command is `bun run test` (Vitest). Do not use `bun test` — Bun's native test runner cannot resolve Nuxt's `~~/` path aliases. See [Getting Started > Running Tests](/guide/getting-started#running-tests) for details.
