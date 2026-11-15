---
title: Database
description: Database schema, access patterns, per-table helpers, type conventions, and migration strategy for nethack.
---

# Database

nethack uses PostgreSQL in development, CI, and production. Both Bun and Node.js use the same bounded `postgres` connection pool through Drizzle ORM. Configure a validated `DATABASE_URL`; `DATABASE_POOL_MAX` defaults to 10 and accepts values from 2 to 64. Database schema definitions live in `server/database/schema.ts`. The startup plugin applies migrations and seeds, and `server/middleware/02.database.ts` attaches the shared Drizzle instance to `event.context.drizzle` before route handlers run.

## Historical SQLite comparison

The selected local backup at `database/basishacks.sqlite` passes SQLite's integrity check and contains 93 teams, 71 of which have non-empty project descriptions. A read-only audit matched all 93 team IDs and all 71 descriptions against the configured PostgreSQL database, with no project-description conflicts. The descriptions were present in the target; the old public showcase exposed only curated pages and did not list each completed season's projects. The public archive now reads these records through the season-specific API.

The importer copies `project_description` when the source schema has that column, but it only accepts an empty or exact fresh-seed target. Never rerun it against populated PostgreSQL data. The comparison also found legacy singleton, season, and user-field conflicts, which remain unchanged for review. The audit is read-only; `bun run db:backup` creates and verifies a PostgreSQL snapshot before any manually reviewed reconciliation.

## Tables

### `hackathon` (singleton)

The legacy singleton (`id = 1`) is retained for export, import compatibility, and rollback. The app reads live event settings from the selected `HACKATHON.yml` by default.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Always 1 |
| `status` | `TEXT` | One of: `not_started`, `in_progress`, `voting`, `finished`, `paused` |
| `voting_enabled` | `INTEGER` | Whether peer voting is enabled |
| `results_published` | `INTEGER` | Whether results are visible |
| `show_scores` | `INTEGER` | Whether participants can see scores in results |
| `show_ranking` | `INTEGER` | Whether participants can see rankings in results |
| `submitted_count` | `INTEGER` | Number of submitted projects |
| `max_votes_per_user` | `INTEGER` | Maximum votes allowed per user |
| `judging_open` | `INTEGER` | Whether judge scoring is open |
| `schedule_start` | `TEXT` | ISO timestamp for event start |
| `schedule_end` | `TEXT` | ISO timestamp for event end |
| `start_timestamp` | `BIGINT` | Event start timestamp in epoch milliseconds |
| `end_timestamp` | `BIGINT` | Event end timestamp in epoch milliseconds |
| `voting_start_timestamp` | `BIGINT` | Voting period start in epoch milliseconds |
| `voting_end_timestamp` | `BIGINT` | Voting period end in epoch milliseconds |
| `results_open_timestamp` | `BIGINT` | Results visibility timestamp in epoch milliseconds |
| `theme_name` | `TEXT` | Hackathon theme name |
| `theme_description` | `TEXT` | Hackathon theme description |
| `live_overrides` | `JSONB` | Portal-managed operational switches that override `HACKATHON.yml` |

Portal changes to `status`, `voting_enabled`, `results_published`, `judging_open`, `show_scores`, `show_ranking`, and `max_votes_per_user` are stored in `live_overrides` and applied on top of the manifest. Schedule, theme, and the rubric remain manifest-owned, so the operational switches keep working with a remote, read-only manifest.

Schedule timestamps are epoch milliseconds. PostgreSQL stores them as `BIGINT`; Drizzle's `mode: "number"` keeps the application and API values as JavaScript numbers.

### `teams`

| Column                | Type                                | Description                   |
| --------------------- | ----------------------------------- | ----------------------------- |
| `id`                  | `INTEGER PRIMARY KEY AUTOINCREMENT` | Team ID                       |
| `name`                | `TEXT NOT NULL`                     | Team name                     |
| `pathway`             | `TEXT`                              | `junior`, `senior`, or `NULL` |
| `score`               | `INTEGER`                           | Final score (out of 100)      |
| `rank`                | `INTEGER`                           | 1-based ranking               |
| `project_name`        | `TEXT NOT NULL DEFAULT ''`          | Submitted project name        |
| `project_description` | `TEXT NOT NULL DEFAULT ''`          | Project description           |
| `project_demo_url`    | `TEXT`                              | Demo URL                      |
| `project_repo_url`    | `TEXT`                              | Repository URL                |
| `project_submitted`   | `INTEGER NOT NULL DEFAULT 0`        | Whether project is submitted  |
| `sourcing`            | `TEXT NOT NULL DEFAULT ''`          | Sourcing information          |
| `season_id`           | `INTEGER NOT NULL`                  | FK to `seasons.id`            |

### `team_scores`

Stores judge scores for each team. Each judge can score a team exactly once.

| Column | Type | Description |
| --- | --- | --- |
| `team_id` | `INTEGER NOT NULL` | FK to `teams.id` |
| `judge_user_id` | `INTEGER NOT NULL` | FK to `users.id` |
| `scores` | `TEXT NOT NULL` | JSON object of rubric scores |
| `reasoning` | `TEXT NOT NULL DEFAULT '<no reasoning provided>'` | Judge's reasoning |
| `season_id` | `INTEGER` | FK to `seasons.id` |

**Primary key**: `(team_id, judge_user_id)`

### `users`

| Column | Type | Description |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | User ID |
| `email` | `TEXT NOT NULL UNIQUE` | User email |
| `name` | `TEXT` | Display name |
| `team_id` | `INTEGER` | FK to `teams.id` |
| `profile_theme` | `TEXT` | Profile theme as `"mode\|value"` |
| `profile_picture` | `TEXT` | Basis-auth picture URL or legacy local asset path |
| `auth_issuer` | `TEXT` | Linked basis-auth issuer |
| `auth_subject` | `TEXT` | Linked basis-auth subject |
| `is_admin` | `INTEGER NOT NULL DEFAULT 0` | Locally promoted administrator flag; designated initial administrators are matched by email |

::: warning The legacy `role` column is retired. Authorization comes from the validated basis-auth `permissions` claim, the participant compatibility bundle, and the local administrator flag. :::

### `ballots`

Each user has exactly one ballot for peer voting.

| Column      | Type                                | Description                 |
| ----------- | ----------------------------------- | --------------------------- |
| `id`        | `INTEGER PRIMARY KEY AUTOINCREMENT` | Ballot ID                   |
| `user_id`   | `INTEGER NOT NULL`                  | FK to `users.id` (unique)   |
| `reasoning` | `TEXT`                              | Voter's reasoning           |
| `submitted` | `INTEGER NOT NULL DEFAULT 0`        | Whether ballot is submitted |

### `ballot_scores`

Individual project scores within a ballot. Scores must be 1–5 or null.

| Column       | Type                                | Description                            |
| ------------ | ----------------------------------- | -------------------------------------- |
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT` | Score ID                               |
| `ballot_id`  | `INTEGER NOT NULL`                  | FK to `ballots.id` (ON DELETE CASCADE) |
| `project_id` | `INTEGER NOT NULL`                  | FK to `teams.id`                       |
| `score`      | `INTEGER`                           | 1, 2, 3, 4, 5, or NULL                 |

**Unique constraint**: `(ballot_id, project_id)`

Basis-auth access and refresh tokens are sealed into an HTTP-only cookie; they are not stored in PostgreSQL. The database contains application users and event data, not browser token sessions.

### `oauth2_applications`

| Column            | Type               | Description                    |
| ----------------- | ------------------ | ------------------------------ |
| `client_id`       | `TEXT PRIMARY KEY` | UUID-based application ID      |
| `client_secret`   | `TEXT NOT NULL`    | Space-separated SHA-256 hashes |
| `permissions`     | `TEXT`             | Space-separated allowed scopes |
| `redirect_uris`   | `TEXT`             | Space-separated redirect URIs  |
| `name`            | `TEXT NOT NULL`    | Application display name       |
| `description`     | `TEXT`             | Application description        |
| `type`            | `TEXT`             | `first` or `third`             |
| `profile_picture` | `TEXT`             | Application icon               |
| `owner_id`        | `INTEGER`          | FK to `users.id`               |

### `seasons`

| Column      | Type                                | Description                                  |
| ----------- | ----------------------------------- | -------------------------------------------- |
| `id`        | `INTEGER PRIMARY KEY AUTOINCREMENT` | Season ID                                    |
| `name`      | `TEXT NOT NULL UNIQUE`              | Season name                                  |
| `is_active` | `INTEGER NOT NULL DEFAULT 0`        | Only one season can be active (CHECK 0 or 1) |

Each season stores a snapshot of its event settings. With YAML enabled the app overlays the live configuration on the active season and saves that configuration to the outgoing season when switching or clearing the active season. The nullable `rubric_version_id` points to an immutable rubric version and is set after the version exists.

The default `Season 1` seed omits its serial ID so PostgreSQL advances `seasons_id_seq` normally. Migration `0004` repairs the sequence for installations that already have explicitly seeded season rows and resets an empty table to generate ID 1.

When the API decides whether to expose a team's `score`/`rank`, it resolves the `show_scores`/`show_ranking` toggles from the team's **own** season (via `getScoreRankVisibilityResolver` in `server/utils/database/seasons.ts`), using live YAML for the active season. Unknown seasons keep scores and ranks private in YAML mode. This keeps past-season results governed by their own season's settings rather than the live season's.

A partial unique index ensures at most one active season:

```sql
CREATE UNIQUE INDEX idx_seasons_active ON seasons(is_active) WHERE is_active = 1;
```

### `user_past_teams`

Junction table tracking which teams a user has belonged to historically.

| Column    | Type               | Description                          |
| --------- | ------------------ | ------------------------------------ |
| `user_id` | `INTEGER NOT NULL` | FK to `users.id` (ON DELETE CASCADE) |
| `team_id` | `INTEGER NOT NULL` | FK to `teams.id` (ON DELETE CASCADE) |

**Primary key**: `(user_id, team_id)`

### `peer_voting_scores`

Stores one peer ballot per user per season. The composite unique index lets a returning participant vote again in a new season without overwriting or destroying their historical ballot.

| Column      | Type               | Description                            |
| ----------- | ------------------ | -------------------------------------- |
| `user_id`   | `INTEGER NOT NULL` | FK to `users.id` (ON DELETE CASCADE)   |
| `season_id` | `INTEGER NOT NULL` | FK to `seasons.id` (ON DELETE CASCADE) |
| `score`     | `TEXT NOT NULL`    | JSON object mapping team IDs to scores |
| `reasoning` | `TEXT`             | Voter's reasoning                      |

**Unique index**: `peer_voting_scores_user_season_unique (user_id, season_id)`

### `team_invites`

Pending team invitations. A member invites an email address; the recipient must accept before their `users.team_id` changes. Invitations are unique per team and email and cascade away with the team.

| Column       | Type                   | Description                           |
| ------------ | ---------------------- | ------------------------------------- |
| `id`         | `SERIAL PRIMARY KEY`   | Invitation ID                         |
| `team_id`    | `INTEGER NOT NULL`     | FK to `teams.id` (ON DELETE CASCADE)  |
| `email`      | `TEXT NOT NULL`        | Lowercased recipient address          |
| `invited_by` | `INTEGER`              | FK to `users.id` (ON DELETE SET NULL) |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Invitation timestamp                  |

Teams accept at most `MAX_TEAM_MEMBERS` (6) members plus pending invitations.

### `awards`

Stores the award catalog. The namespace, display name, description, and icon are data managed in PostgreSQL rather than hard-coded in the application.

| Column        | Type                        | Description                              |
| ------------- | --------------------------- | ---------------------------------------- |
| `namespace`   | `TEXT PRIMARY KEY NOT NULL` | Unique machine-readable award identifier |
| `name`        | `TEXT NOT NULL`             | Human-readable award name                |
| `description` | `TEXT NOT NULL`             | Explanation of how the award is earned   |
| `icon`        | `TEXT NOT NULL`             | Iconify icon class                       |
| `color`       | `TEXT NOT NULL`             | Display color (defaults to `gold`)       |

### `team_awards`

Stores per-team award assignments and JSON metadata. Award details are joined from `awards` at read time.

| Column    | Type               | Description                                     |
| --------- | ------------------ | ----------------------------------------------- |
| `team_id` | `INTEGER NOT NULL` | FK to `teams.id` (ON DELETE CASCADE)            |
| `award`   | `TEXT NOT NULL`    | Award namespace from `awards.namespace`         |
| `meta`    | `TEXT NOT NULL`    | JSON metadata for the assignment (default `{}`) |

**Primary key**: `(team_id, award)`

## Access Patterns

All database access goes through `event.context.drizzle` (a Drizzle ORM instance). Per-table helpers in `server/utils/database/*.ts` wrap common queries:

```ts
// Read a single row via the users helper
import { getUser } from "~~/server/utils/database/users";
const user = await getUser(event, userId);

// Read multiple rows via the teams helper
import { getTeamsBySeason } from "~~/server/utils/database/teams";
const teams = await getTeamsBySeason(event, seasonId);

// Write via the users helper
import { updateUserName } from "~~/server/utils/database/users";
await updateUserName(event, userId, name);
```

For queries not covered by a helper, use the Drizzle instance directly:

```ts
import { users } from "~~/server/database/schema";

const drizzle = event.context.drizzle;
const user = await drizzle.select().from(users).where(eq(users.id, userId)).get();
```

::: tip Always use Drizzle's parameterized query builders. Never interpolate user input directly into SQL strings. :::

## Per-table Helpers

Each table has a dedicated helper module in `server/utils/database/`:

| File | Key Functions |
| --- | --- |
| `users.ts` | `getUser`, `getUserByEmail`, `findOrLinkBasisAuthUser`, `getUserByBasisAuthSubject`, `updateUserName`, `updateUserProfileTheme` |
| `teams.ts` | Team CRUD, project submission |
| `members.ts` | Team member management |
| `scores.ts` | Judge score CRUD |
| `ballots.ts` | Ballot and ballot score management |
| `hackathon.ts` | Hackathon state queries and updates |
| `oauth2_applications.ts` | Application CRUD, secret management, redirect URI management |
| `seasons.ts` | `getSeasons`, `getSeasonById`, `getActiveSeason`, `setActiveSeason`, `getScoreRankVisibilityResolver` |
| `awards.ts` | `getAwards`, `getAwardsForTeams`, `createAward`, `deleteTeamAwards`, `deleteAward` |

## Type Conventions

TypeScript types in `shared/database.d.ts` must stay in sync with the SQL schema. These types represent raw database rows:

```ts
interface User {
    id: number;
    email: string;
    role: string;
    name: string | null;
    team_id: number | null;
    profile_theme: string | null;
    profile_picture: string | null;
}
```

API response types in `shared/responses.d.ts` represent the public-facing shape after conversion:

```ts
interface APIUser {
    id: number;
    email: string;
    role: string;
    name: string | null;
    team_id: number | null;
    profile_theme: ProfileTheme | null; // parsed from "mode|value"
    profile_picture: string | null;
}
```

The conversion is handled by `convertUserToPublic()` and `convertTeamToPublic()` in `server/utils/convert.ts`.

## Profile Themes

Profile themes are stored in the database as `"mode|value"` strings and parsed into structured objects in the API layer:

```ts
// Database storage: "gradient|from-blue-500 to-purple-600"
// API response: { mode: "gradient", value: "from-blue-500 to-purple-600" }
```

Allowed modes: `url`, `emoji`, `gradient`. If the mode is unrecognized, it defaults to `emoji`.

## Migrations

Drizzle Kit generates PostgreSQL migration files from `server/database/schema.ts` into `drizzle/postgres/`:

```bash
bun run db:generate
```

Apply pending migrations explicitly during release workflows with `bun run db:migrate`. Nitro also applies them at startup before it serves requests. `server/database/migrate.ts` takes a PostgreSQL advisory lock while applying migrations, so concurrent starts do not race the migration ledger. Keep schema changes and generated migration SQL in the same change.

## SQLite import

SQLite is a source format for the one-time VPS cutover only. The importer is read-only against its SQLite backup, accepts an empty PostgreSQL target or the complete exact seed created by fresh migrations, and executes the import in one transaction. Partial or modified seed state and other target data are rejected. It preserves IDs and relationships, sets PostgreSQL identity sequences, checks row counts and foreign-key references, and writes the legacy-only columns and old score migration artifact to `sqlite_legacy_data`.

Run a source-only check with `bun run db:import-sqlite:check`, then apply with `bun run db:import-sqlite -- --confirm`. See [PostgreSQL and VPS deployment](/deployment/postgresql-migration) for backup, maintenance-window, and rollback steps.

## Foreign keys and transactions

PostgreSQL enforces relationships declared in the Drizzle schema. Use transactions for operations that update related rows, and preserve the configured `ON DELETE` behavior when changing relationship constraints. The importer checks both the source's references and the target's referential integrity before committing.

All ordinary application reads and writes should use Drizzle's parameterized query builders. Use the documented migration runner for schema changes; do not issue ad hoc production schema changes outside a reviewed migration.
