---
title: PostgreSQL and VPS Deployment
description: Prepare PostgreSQL, migrate an existing SQLite deployment safely, and run basishacks under Bun or Node.js on a VPS.
---

# PostgreSQL and VPS Deployment

Production and development use PostgreSQL through Drizzle ORM and the `postgres` driver. The SQLite adapter is no longer part of the application runtime. Use `bun run start` or, on Linux, `npm run start`; both select Bun 1.3.14 when installed and otherwise use Node.js 24 or newer. Run `node start-fix.mjs` to explicitly select Node.js.

## PostgreSQL configuration

Set `DATABASE_URL` in the process environment or protected environment file. It must be a valid `postgres://` or `postgresql://` URL. `DATABASE_POOL_MAX` defaults to `10` and accepts integers from `2` through `64`. The app uses a bounded pool; PostgreSQL itself is outside the app service memory limit.

```dotenv
DATABASE_URL=postgresql://basishacks:replace_me@127.0.0.1:5432/basishacks
DATABASE_POOL_MAX=10
```

Use a dedicated PostgreSQL role with only the privileges needed by the application. Keep the URL and authentication secrets in a root-readable environment file, such as `/etc/basishacks/basishacks.env`, and never commit production credentials.

Event schedule fields (`start_timestamp`, `end_timestamp`, `voting_start_timestamp`, `voting_end_timestamp`, and `results_open_timestamp`) are epoch milliseconds exposed as JavaScript numbers. PostgreSQL stores these values as `bigint` so current-era millisecond values fit without changing the API representation. The latest migration widens existing integer columns without changing their stored values.

Migrations run automatically before Nitro starts accepting requests. Release workflows and extracted release bundles can apply them explicitly with:

```bash
bun run db:migrate
# In the release bundle under Node.js:
node .output/tools/db-migrate.mjs
```

The migration runner takes a PostgreSQL advisory lock so two starting processes do not apply the same migration concurrently. Migration `0004` advances or resets the `seasons` serial sequence to match existing rows and adds a foreign key from `seasons.rubric_version_id` to `rubric_versions.id`. It clears only dangling rubric pointers before adding the constraint; startup seeding restores the default version pointer before requests are served. The release package includes its Drizzle migration journal/SQL, `package.json`, `bun.lock`, and production dependencies. When building locally, run `bun install --production --frozen-lockfile` after `bun run build`, then set `VPS_RELEASE_INCLUDE_NODE_MODULES=1` while running `bun run release:package`. Production-only installs skip source preparation because the Nuxt output has already been built. GitHub tag archives perform these steps automatically.

## One-time SQLite import

Run the importer only for a cutover from an existing SQLite deployment. It reads the source file in read-only mode and writes to a newly migrated, otherwise empty PostgreSQL database. It will not merge into a populated target. The import is one PostgreSQL transaction and rolls back if a row count or relationship check fails.

### 1. Back up and stop the existing service

Schedule a maintenance window, stop the old app, and take a verified SQLite backup. For example, when the SQLite command-line tool is installed:

```bash
sqlite3 /srv/basishacks/database/basishacks.sqlite \
  ".backup '/srv/backups/basishacks-pre-postgres.sqlite'"
sqlite3 /srv/backups/basishacks-pre-postgres.sqlite 'PRAGMA integrity_check;'
```

The integrity check must return `ok`. Keep the original database and a separate backup until the new release has been verified. Back up user-uploaded files separately; the importer moves database rows only. The importer opens SQLite read-only and enables `query_only`; missing required relationships outside `team_scores`, unknown non-metadata tables, or a broken schema stop the import without changing the source. `team_scores` rows whose team or judge references are invalid are preserved with their complete source payload in `sqlite_legacy_data` and excluded from active scores. Only linked score rows are imported into the foreign-key-constrained PostgreSQL table. Review the import report's `archivedOrphanRows` counts before cutover.

CI fixtures and local SQLite files without confirmed production provenance are rehearsal samples only. They verify importer behavior but do not qualify as the production backup or prove that production history is complete.

### Preserve existing uploads in the checkout

Runtime uploads now live in the project-root `/assets` directory. It is gitignored, so an in-place pull/build/start deployment preserves it. Before a re-clone, checkout replacement, or first deployment with existing uploads, copy the prior runtime storage into the new checkout's `/assets`, preserving the `assets/` and `userassets/` collection layout and existing names. For example, adapt the source and destination to the actual old and new project paths:

```bash
sudo install -d -o basishacks -g basishacks -m 0750 /opt/basishacks/current/assets
sudo rsync -a /path/to/previous/runtime-assets/ /opt/basishacks/current/assets/
sudo chown -R basishacks:basishacks /opt/basishacks/current/assets
sudo chmod -R u+rwX,go-rwx /opt/basishacks/current/assets
```

If the previous checkout stored legacy profile images in `public/userassets`, copy them into the new checkout's `/assets/userassets/` collection with their existing filenames too. Review same-name conflicts before copying and do not overwrite files silently. Keep a separate backup until representative profile images and permalink uploads have been checked after cutover. Preserve legacy non-hashed filenames unchanged: automatic collection deliberately ignores them. The committed static showcase under `public/assets` is not runtime storage and must not be copied over `/assets`.

### 2. Provision and migrate an empty PostgreSQL database

Configure `DATABASE_URL` and `DATABASE_POOL_MAX`, then run the bundled PostgreSQL migrations before importing. The importer accepts either an empty target or the complete, exact seed produced by `bun run db:migrate` (hackathon, Season 1, and the default rubric template/version). It removes those seed rows inside the import transaction before inserting SQLite history. Any partial or modified seed, or any other target data, stops the import without committing changes.

### 3. Check the SQLite source

Set `SQLITE_IMPORT_PATH` to the verified backup path. The check command reads and validates the SQLite file without contacting PostgreSQL or changing either database:

```bash
export SQLITE_IMPORT_PATH=/srv/backups/basishacks-pre-postgres.sqlite
bun run db:import-sqlite:check
```

It reports per-table source counts and fails if required source tables are missing, an unrecognized non-metadata table exists, or relationships outside `team_scores` contain orphan rows. A `team_scores` row that refers to a missing team or judge is preserved in `sqlite_legacy_data` with its original values and reported for review; it is not imported as a live score or repaired automatically. Review those archived rows before cutover. The read-only source remains untouched.

### 4. Import and verify

With the old app stopped and the target database migrated but otherwise empty, run the bundled importer:

```bash
bun run db:import-sqlite -- --confirm
```

The VPS release bundle includes the importer and its runtime dependencies. Bun reads SQLite through its built-in driver; Node.js uses the packaged `better-sqlite3` dependency. Both runtimes support the importer commands shown above.

The importer preserves explicit IDs and records for teams, users, seasons, submissions, ballots, ballot scores, judge scores, peer-voting scores, legacy `sc_votes`, awards, OAuth application records, and historical team membership. It infers and persists a missing score `season_id` from its team's season (or the active/first season when a source team has no season ID), updates PostgreSQL serial sequences, creates one immutable `Imported legacy rubric` version per season, assigns legacy judge score rows to the version for their season, and writes removed SQLite-only fields (`users.role`, `users.age`, `oauth2_applications.proxy_microsoft`) and the legacy `judge_scores_migrate` artifact to `sqlite_legacy_data`. The CSV header row in that artifact is excluded; data-row counts are reported separately.

Season event timestamps accept ISO dates and safe epoch-millisecond values, including text serialized with a zero-only fractional part such as `1780149600000.0`; unsafe or genuinely fractional values are rejected instead of rounded. A missing or `NULL` season timestamp maps to `0`, the PostgreSQL schema's unset-time value. Missing or `NULL` team `sourcing` text maps to an empty string, matching the PostgreSQL column's not-null default.

The importer also supports the earlier single-hackathon schema when it has no `seasons` table and both `teams` and `team_scores` have no `season_id`. It requires exactly the canonical `hackathon` row (`id = 1`), maps that configuration to one active season with ID `1`, and assigns all imported teams and scores to that season. ISO-formatted legacy event timestamps are converted to epoch milliseconds for the PostgreSQL `bigint` columns; integer timestamps and exact zero-fraction numeric strings are retained as integer milliseconds. Missing score-visibility flags default to `0`. The import creates the same immutable default legacy rubric version for this season. A `seasons` table with no rows, or any mixed schema where season columns and tables do not agree, is rejected rather than guessed.

Where the old SQLite `team_scores` table has a standalone `id` that the PostgreSQL composite key does not have, the value is retained in `sqlite_legacy_data` under the score's source row key while the score content, team ID, and judge ID are imported normally. Legacy `users.login_code` and `users.login_expiry` are deliberately discarded: these are one-time authentication credentials from the retired login flow, and neither is copied to PostgreSQL or the legacy archive. User IDs and team relationships remain preserved.

Older SQLite schemas did not record an immutable rubric definition with each score. The importer snapshots the rubric definition available in `shared/rubric.ts` at import time. It cannot reconstruct rubric edits that were never stored in SQLite.

Before cutover, compare the reported row counts with a read-only query against PostgreSQL, confirm no relationship errors, check the imported active season and score visibility, and review representative teams, users, submissions, ballots, and judge scores. Keep the old service and source backup available for rollback until those checks pass.

### 5. Start the release

For the direct Git checkout deployment, keep using the same project directory, install dependencies, build, apply migrations, and start the server:

```bash
cd /opt/basishacks/current
bun install --frozen-lockfile
bun run build
bun run db:migrate
bun run start

# Or use Node.js with the same built checkout:
node start-fix.mjs
```

The app also applies migrations under an advisory lock on startup. GitHub tag archives remain an optional deployment format and already contain production dependencies; if using one, preserve or restore the project's `/assets` directory in the working checkout before serving.

Keep the gitignored project-root `/assets` directory in the checked-out project and make it writable by the service account. An in-place pull/build/start preserves it; a re-clone or fresh checkout must restore it before serving. Back it up separately from PostgreSQL. The committed showcase at `public/assets` is separate. Put a TLS reverse proxy in front of the app and bind Nitro to the loopback interface when the proxy runs on the same host.

## systemd service

Ready-to-copy unit files are in `deploy/systemd/basishacks-bun.service` and `deploy/systemd/basishacks-node.service`. Both set a 450,000,000-byte soft memory threshold and a 500,000,000-byte hard limit, grant write access only to the project's `/assets` upload directory, and run with systemd filesystem protections.

Create a dedicated `basishacks` system user, install the project under `/opt/basishacks/current`, ensure `/opt/basishacks/current/assets` exists and is owned by that user, and create `/etc/basishacks/basishacks.env` with mode `0600`. The service unit's `ReadWritePaths` must point at that checkout's `/assets` directory. Then install one of the service units:

```bash
sudo install -m 0644 deploy/systemd/basishacks-bun.service /etc/systemd/system/basishacks.service
sudo systemctl daemon-reload
sudo systemctl enable --now basishacks.service
sudo systemctl status basishacks.service
```

Choose the Node unit instead when running Node.js. Do not enable both units on the same port. PostgreSQL needs its own backup, disk, and memory monitoring; its usage is separate from the app service's cgroup limit.
