---
title: Getting Started
description: Get the basishacks hackathon platform running on your local machine.
---

# Getting Started

This guide walks you through setting up the **basishacks** development environment from scratch. By the end, you will have the application running locally with HTTPS on port 24598.

<StatusBadge status="online" text="Docs build status: passing" />

## Prerequisites

Before you begin, ensure you have the following installed:

| Requirement | Minimum Version | Notes                                       |
| ----------- | --------------- | ------------------------------------------- |
| **Node.js** | >= v24          | Required by the runtime and tooling         |
| **Bun**     | 1.3.14          | Supported package manager; `npm` also works |
| **Git**     | Any recent      | For cloning the repository                  |

### Installing Bun

If Bun is not installed:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify the installation:

```bash
bun --version
```

### Verifying Node.js

```bash
node --version
# Should output v24.x.x or higher
```

If you need to manage multiple Node.js versions, consider using [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm).

## Clone the Repository

<TerminalWindow title="basishacks@setup:~" prompt="$">

```bash
git clone <repository-url> basishacks-r2
git clone https://github.com/biszdevelopers/basis-schema.git basis-schema
cd basishacks-r2
```

</TerminalWindow>

## Install Dependencies

Install all project dependencies using Bun:

```bash
bun i
```

The [`@basis/schema`](https://github.com/biszdevelopers/basis-schema) checkout must remain beside `basishacks-r2`. The Nuxt and Vitest configurations resolve its source from `../basis-schema`; no Bun link is required. Use Bun 1.3.14 to install from the committed lockfile.

If you prefer npm:

```bash
npm install
```

<CopyButton content="bun i" label="copy bun install" />

## Initialize the Database

Development, CI, and production use PostgreSQL through Drizzle ORM and the `postgres` driver. Set `DATABASE_URL` before starting Nuxt. The `init-database.ts` plugin creates the bounded connection pool, applies migrations under an advisory lock, and seeds the default hackathon row.

To manually initialize the database:

```bash
bun run db:migrate
```

This applies the pending PostgreSQL migrations. Migrations also run automatically at server startup.

### Seed the Hackathon Row

The `hackathon` table has a singleton row with `id = 1`; startup seeds it if it is missing. Do not add a second row or edit it directly outside application code.

### Apply Migrations

Migrations are generated with Drizzle Kit:

```bash
# Generate a migration after schema changes
bun run db:generate
```

The `db:migrate` script applies pending migrations via Drizzle Kit. In practice, the server also applies migrations automatically on startup, so manual runs are usually unnecessary:

```bash
bun run db:migrate
```

## Configure Environment Variables

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

At minimum, set the following:

```bash
# REQUIRED - PostgreSQL connection for development, CI, and production
DATABASE_URL=postgresql://basishacks:secret@127.0.0.1:5432/basishacks

# OPTIONAL - Bounded pool size (default 10, range 2-64)
DATABASE_POOL_MAX=10

# REQUIRED - Session encryption key. Must be at least 32 bytes.
BASIS_AUTH_COOKIE_SECRET=your_random_string_at_least_32_bytes_long

# REQUIRED - basis-auth confidential client configuration
BASIS_AUTH_ISSUER=http://localhost:3000
BASIS_AUTH_CLIENT_ID=your_client_id
BASIS_AUTH_CLIENT_SECRET=your_client_secret
BASIS_AUTH_RESOURCE=devconnect://nethack.bisz.dev
```

Set `CURRENT_URL_ORIGIN` to the basishacks origin and register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` with basis-auth. See [Environment Setup](/guide/environment-setup) for the full list.

## Run the Development Server

Start the dev server with HTTPS enabled:

```bash
bun dev --https
```

Or with npm:

```bash
npm run dev -- --https
```

The server starts on **port 24598** with HTTPS. Open your browser to:

```
https://localhost:24598
```

:::: warning Use the `--https` flag because secure session cookies require a trusted context. You may see a self-signed certificate warning in your browser; accept it to proceed. ::::

## Production Build

Build the application for production:

```bash
bun run build
```

For artifacts built by GitHub Actions, rewrite the embedded checkout root for the production server before packaging:

```bash
bun run refractor-artifact
```

This replaces `/home/runner/work/basishacks-r2/basishacks-r2` with `/home/devleaderz/basishacks-r2` throughout `.output/`.

Preview the production build:

```bash
bun run preview
```

The preview server runs on port 24598.

## Running Tests

The project uses [Vitest](https://vitest.dev) as its test framework. The suite maintains **100% line, branch, function, and statement coverage** on all tracked source files and currently contains **<TestCount /> passing tests** covering the API, server utilities, database helpers, shared schemas, and frontend components.

```bash
# Run the full test suite (canonical command)
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with coverage
bun run test:coverage
```

These invoke `vitest run --pool=forks`, which resolves Nuxt's `~~/` and `~/` path aliases via `vitest.config.ts` and runs `tests/setup.ts` to populate in-memory SQLite databases. See the [Testing guide](/guide/testing) for more details on the coverage policy and excluded files.

### About `bun test`

Bun's native test runner (`bun test`) cannot resolve Nuxt's `~~/` and `~/` path aliases, and the test files import their assertions from `vitest` rather than `bun:test`. Running `bun test` would therefore produce dozens of "Cannot find module '~~/...'" errors.

To avoid confusion, `bunfig.toml` scopes `bun test` to a single shim (`bun-shim/shim.test.ts`) that prints guidance directing you to run `bun run test` instead. The shim exits successfully so `bun test` never appears to fail.

### Authentication integration tests

The active Vitest suite covers the basis-auth authorization request, callback transaction validation, verified identity linking, and protected-resource token validation.

### Legacy test script

`tests/index.js`, `tests/test.oauth2.js`, and `tests/test.deepseek.ts` are legacy manual test runners kept for reference. They are not part of the active Vitest suite.

## First Login Flow

Once the server is running, follow these steps to log in for the first time:

1. **Navigate to the login page** — Click the login button or go to `/login`.
2. **Sign in with basis-auth** — Start login from basishacks and complete authentication at the configured basis-auth issuer.
3. **Access the dashboard** — After successful authentication, you are redirected to the dashboard.

### Alternative Login Methods

### Gaining Admin Access

Authorization comes from validated basis-auth token permissions. Ask the basis-auth operator to grant the development account `nethack.all`; local database edits do not grant admin access. Refresh the browser session after the permission change.

## Verify Everything Works

After logging in, check the following:

- **Dashboard** loads at `/dashboard`
- **Teams page** is accessible at `/dashboard/teams`
- **Profile page** shows your user information at `/profile`
- **Admin/Mod portal** (if elevated) is available at `/developers`

## Next Steps

- [Project Overview](/guide/project-overview) — Understand the full project structure and features
- [Environment Setup](/guide/environment-setup) — Configure your development environment in detail
- [Architecture](/architecture/overview) — Deep dive into how the app works
