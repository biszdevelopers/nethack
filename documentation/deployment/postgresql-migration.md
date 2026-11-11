---
title: PostgreSQL and VPS Deployment
description: Prepare PostgreSQL, migrate an existing SQLite deployment safely, and run basishacks under Bun or Node.js on a VPS.
---

# PostgreSQL and VPS Deployment

Production and development use PostgreSQL through Drizzle ORM and the `postgres` driver. The SQLite adapter is no longer part of the application runtime. The supported production entry points are `bun run start` and `node start-fix.mjs`.

## PostgreSQL configuration

Set `DATABASE_URL` in the process environment or protected environment file. It must be a valid `postgres://` or `postgresql://` URL. `DATABASE_POOL_MAX` defaults to `10` and accepts integers from `2` through `64`. The app uses a bounded pool; PostgreSQL itself is outside the app service memory limit.

```dotenv
DATABASE_URL=postgresql://basishacks:replace_me@127.0.0.1:5432/basishacks
DATABASE_POOL_MAX=10
ASSET_STORAGE_DIR=/var/lib/basishacks/assets
```

Use a dedicated PostgreSQL role with only the privileges needed by the application. Keep the URL and authentication secrets in a root-readable environment file, such as `/etc/basishacks/basishacks.env`, and never commit production credentials.

Migrations run automatically before Nitro starts accepting requests. Release workflows and extracted release bundles can apply them explicitly with:

```bash
bun run db:migrate
# In the release bundle under Node.js:
node .output/tools/db-migrate.mjs
```

The migration runner takes a PostgreSQL advisory lock so two starting processes do not apply the same migration concurrently. The release package includes its Drizzle migration journal/SQL, `package.json`, `bun.lock`, and production dependencies. When building locally, run `bun install --production --frozen-lockfile` after `bun run build`, then set `VPS_RELEASE_INCLUDE_NODE_MODULES=1` while running `bun run release:package`. GitHub tag archives perform these steps automatically.

## One-time SQLite import

Run the importer only for a cutover from an existing SQLite deployment. It reads the source file in read-only mode and writes to a newly migrated, otherwise empty PostgreSQL database. It will not merge into a populated target. The import is one PostgreSQL transaction and rolls back if a row count or relationship check fails.

### 1. Back up and stop the existing service

Schedule a maintenance window, stop the old app, and take a verified SQLite backup. For example, when the SQLite command-line tool is installed:

```bash
sqlite3 /srv/basishacks/database/basishacks.sqlite \
  ".backup '/srv/backups/basishacks-pre-postgres.sqlite'"
sqlite3 /srv/backups/basishacks-pre-postgres.sqlite 'PRAGMA integrity_check;'
```

The integrity check must return `ok`. Keep the original database and a separate backup until the new release has been verified. Back up user-uploaded files separately; the importer moves database rows only. The importer opens SQLite read-only and enables `query_only`; source orphan references, missing relationships, or unknown non-metadata tables stop the import without changing the source. In particular, each `team_scores.team_id` and `team_scores.judge_user_id` must resolve to an existing team and user.

### Copy existing uploads to persistent storage

Before switching releases, copy existing user uploads from the old release's `public/userassets` directory into `$ASSET_STORAGE_DIR/userassets`. For the default storage root:

```bash
sudo install -d -o basishacks -g basishacks -m 0750 /var/lib/basishacks/assets/userassets
sudo rsync -a /opt/basishacks/old/public/userassets/ /var/lib/basishacks/assets/userassets/
sudo chown -R basishacks:basishacks /var/lib/basishacks/assets/userassets
sudo chmod -R u+rwX,go-rwx /var/lib/basishacks/assets/userassets
```

If you configure another absolute `ASSET_STORAGE_DIR`, use that path instead and ensure the service account can read and write it. Keep the source directory until uploaded assets have been checked after cutover.

### 2. Provision and migrate an empty PostgreSQL database

Configure `DATABASE_URL` and `DATABASE_POOL_MAX`, then run the bundled PostgreSQL migrations before importing. The importer accepts either an empty target or the complete, exact seed produced by `bun run db:migrate` (hackathon, Season 1, and the default rubric template/version). It removes those seed rows inside the import transaction before inserting SQLite history. Any partial or modified seed, or any other target data, stops the import without committing changes.

### 3. Check the SQLite source

Set `SQLITE_IMPORT_PATH` to the verified backup path. The check command reads and validates the SQLite file without contacting PostgreSQL or changing either database:

```bash
export SQLITE_IMPORT_PATH=/srv/backups/basishacks-pre-postgres.sqlite
bun run db:import-sqlite:check
```

It reports per-table source counts and fails if required source tables are missing, an unrecognized non-metadata table exists, or existing relationships contain orphan rows. Resolve any reported source issue or restore a clean backup; do not bypass the checks. For example, a `team_scores` row referring to a missing team or judge is not imported and does not get dropped or repaired automatically. The read-only source remains untouched.

### 4. Import and verify

With the old app stopped and the target database migrated but otherwise empty, run the bundled importer:

```bash
bun run db:import-sqlite -- --confirm
```

The VPS release bundle includes the importer and its runtime dependencies. Bun reads SQLite through its built-in driver; Node.js uses the packaged `better-sqlite3` dependency. Both runtimes support the importer commands shown above.

The importer preserves explicit IDs and records for teams, users, seasons, submissions, ballots, ballot scores, judge scores, peer-voting scores, legacy `sc_votes`, awards, OAuth application records, and historical team membership. It infers and persists a missing score `season_id` from its team's season (or the active/first season when a source team has no season ID), updates PostgreSQL serial sequences, creates one immutable `Imported legacy rubric` version per season, assigns legacy judge score rows to the version for their season, and writes removed SQLite-only fields (`users.role`, `users.age`, `oauth2_applications.proxy_microsoft`) and the legacy `judge_scores_migrate` artifact to `sqlite_legacy_data`. The CSV header row in that artifact is excluded; data-row counts are reported separately.

Older SQLite schemas did not record an immutable rubric definition with each score. The importer snapshots the rubric definition available in `shared/rubric.ts` at import time. It cannot reconstruct rubric edits that were never stored in SQLite.

Before cutover, compare the reported row counts with a read-only query against PostgreSQL, confirm no relationship errors, check the imported active season and score visibility, and review representative teams, users, submissions, ballots, and judge scores. Keep the old service and source backup available for rollback until those checks pass.

### 5. Start the release

Build the artifact and start either runtime:

```bash
bun run build
bun install --production --frozen-lockfile
VPS_RELEASE_INCLUDE_NODE_MODULES=1 bun run release:package
cd release-package
bun run db:migrate
bun run start

# Or, using Node.js with the same release package:
node start-fix.mjs
```

GitHub tag archives already contain the production dependencies. PowerShell users can set the packaging flag with `$env:VPS_RELEASE_INCLUDE_NODE_MODULES = "1"` before running `bun run release:package`.

Keep uploads in persistent storage outside the versioned release directory. `ASSET_STORAGE_DIR` defaults to `/var/lib/basishacks/assets`. The service account needs write access to that directory. Put a TLS reverse proxy in front of the app and bind Nitro to the loopback interface when the proxy runs on the same host.

## systemd service

Ready-to-copy unit files are in `deploy/systemd/basishacks-bun.service` and `deploy/systemd/basishacks-node.service`. Both set a 450,000,000-byte soft memory threshold and a 500,000,000-byte hard limit, use a separate persistent state directory, and run with systemd filesystem protections.

Create a dedicated `basishacks` system user, install the release under `/opt/basishacks/current`, and create `/etc/basishacks/basishacks.env` with mode `0600`. Then install one of the service units:

```bash
sudo install -m 0644 deploy/systemd/basishacks-bun.service /etc/systemd/system/basishacks.service
sudo systemctl daemon-reload
sudo systemctl enable --now basishacks.service
sudo systemctl status basishacks.service
```

Choose the Node unit instead when running Node.js. Do not enable both units on the same port. PostgreSQL needs its own backup, disk, and memory monitoring; its usage is separate from the app service's cgroup limit.
