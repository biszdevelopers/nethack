# Testing

The `basishacks` project uses [Vitest](https://vitest.dev) for unit and integration testing. The goal of the test suite is to give every contributor confidence that changes to authentication, voting, scoring, team management, and OAuth2 flows do not break existing behavior.

## Running the Test Suite

Use the following npm/Bun scripts:

```bash
# Run the full suite once
bun run test

# Run tests in watch mode during development
bun run test:watch

# Run tests with coverage reporting
bun run test:coverage
```

The canonical command is `bun run test`, which executes `vitest run --pool=forks --reporter=json | bun run test:meta`. This resolves Nuxt's `~~/` and `~/` path aliases through `vitest.config.ts`, loads `tests/setup.ts` before each test file, and automatically generates `tests/.test-meta.json` with the current test count. The `test:meta` script reads the vitest JSON output from stdin and writes a summary file used by the VitePress documentation's `<TestCount />` component for dynamic test count display.

## Coverage Policy

Coverage is measured by line, branch, function, and statement counts. `bun run test:coverage` measures executable JavaScript, TypeScript, and MJS source files under `app/`, `server/`, `shared/`, and `scripts/`, plus the production launcher and Drizzle configuration. It merges client and server builds for compile-time branches. The command fails unless every included metric reaches 100%, every executable source file has counters, every source file is represented, and each compile-time runtime conditional appears in both reports. Only the explicit type-only and static-configuration files listed below may have no executable counters.

### Current Coverage Status

The test suite currently has **<TestCount /> passing tests**. The number is generated from the latest successful Vitest run.

### Coverage Exclusions

The following files and directories are excluded from coverage because they are configuration, generated artifacts, test infrastructure, or documentation:

- `nuxt.config.ts` — Nuxt configuration
- `app/app.config.ts` — static UI configuration with no executable branches
- `app/components/admin/rubric-types.ts` — type-only declarations
- `tests/**/helpers.ts` — Test-only helper modules
- `bun-shim/**` — Bun test runner shim
- `drizzle/**` — Generated migration SQL and metadata snapshots
- `sql/archive/**` — Historical SQL archives
- `documentation/**` — VitePress documentation site
- `**/*.d.ts` — TypeScript declaration files
- `**/node_modules/**` — Third-party dependencies

These exclusions are configured in `vitest.config.ts` under `test.coverage.exclude`; the two zero-counter files are allowlisted in `tests/helpers/merge-vitest-coverage.mjs`. `start-fix.mjs` and `drizzle.config.ts` are included in coverage.

## Test Organization

Tests live in the `tests/` directory and mirror the project structure:

| Directory                      | Contents                                    |
| ------------------------------ | ------------------------------------------- |
| `tests/api/`                   | API route handlers (`server/api/**`)        |
| `tests/server/utils/`          | Server utilities and helpers                |
| `tests/server/utils/database/` | Database helper functions                   |
| `tests/server/middleware/`     | Nitro middleware                            |
| `tests/server/plugins/`        | Nitro plugins                               |
| `tests/server/database/`       | Database initialization and migration logic |
| `tests/shared/`                | Shared schemas, permissions, rubric, etc.   |
| `tests/components/`            | Vue components                              |
| `tests/composables/`           | Vue composables                             |
| `tests/pages/`                 | Nuxt pages                                  |
| `tests/middleware/`            | Route middleware                            |
| `tests/frontend/`              | Frontend-specific behavior                  |

## Writing Tests

Tests use Vitest's global API (`describe`, `it`, `expect`, `vi`) and the project-specific helpers in `tests/api/helpers.ts` and `tests/server/utils/database/helpers.ts`. When testing API routes, prefer creating a minimal H3 event and invoking the route handler directly, mocking external dependencies such as `fetch`, `jose`, and basis-auth session helpers as needed.

Most API and database-helper tests use isolated in-memory SQLite fixtures for fast setup. The PostgreSQL integration test in `tests/server/database/postgres.integration.test.ts` runs the real migration and verifies JSON storage, uniqueness, and foreign-key enforcement. Run it with `DATABASE_URL` set and `BASISHACKS_POSTGRES_TEST=1`; CI provides a PostgreSQL service and runs the integration test with the full Vitest suite. The SQLite-backed unit fixtures do not replace broader PostgreSQL-backed API coverage.

If you add a new branch to a source file, add a test that exercises it. CI runs `bun run test:coverage` and rejects pull requests when any included source file is missing, unmeasured, or falls below 100% statements, branches, functions, or lines. Vue single-file components and CSS are not runtime-instrumented by this gate. Current role-journey checks assert source contracts; they do not execute rendered UI, cover keyboard/focus interactions, or verify responsive layouts. Browser viewport and accessibility journeys remain a separate release check.

## About `bun test`

Do not use Bun's native test runner (`bun test`) for this project. It cannot resolve Nuxt's `~~/` and `~/` path aliases, and the test files import assertions from `vitest` rather than `bun:test`.

To prevent accidental use, `bunfig.toml` scopes `bun test` to a single shim (`bun-shim/shim.test.ts`) that prints guidance directing you to `bun run test` instead. The shim exits successfully so `bun test` never appears to fail silently.

## Legacy Test Scripts

`tests/index.js`, `tests/test.oauth2.js`, `tests/test.microsoft.ts`, and `tests/test.deepseek.ts` are legacy manual test runners kept for reference. They are not part of the active Vitest suite and do not contribute to coverage.
