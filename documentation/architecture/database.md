---
title: Database
description: Database schema, access patterns, per-table helpers, type conventions, and migration strategy for nethack.
---

# Database

nethack uses PostgreSQL in development, CI, and production. Both Bun and Node.js use the same bounded `postgres` connection pool through Drizzle ORM. Configure a validated `DATABASE_URL`; `DATABASE_POOL_MAX` defaults to 10 and accepts values from 2 to 64. Connections set `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 30s`, a 20-second idle timeout, a 30-minute maximum lifetime, and `prepare: false`. Database schema definitions live in `server/database/schema.ts`. The startup plugin applies migrations and seeds, and `server/middleware/02.database.ts` attaches the shared Drizzle instance to `event.context.drizzle` before route handlers run.

Set `DATABASE_METRICS=1` to publish bounded query/pool timing summaries once per minute. `DATABASE_SLOW_QUERY_MS` (default 250) controls when a query appears in the slow-query log. Slow-query entries contain only the duration, threshold, and timestamp.

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
| `announcement` | `TEXT` | Admin-editable home-page announcement |
| `live_overrides` | `JSONB` | Portal-managed operational switches that override `HACKATHON.yml` |

Portal changes to `status`, `voting_enabled`, `results_published`, `judging_open`, `show_scores`, `show_ranking`, `max_votes_per_user`, the five schedule timestamps, `theme_name`, `theme_description`, and `announcement` are stored in PostgreSQL. They are written to the active season row and the `hackathon` singleton, with `live_overrides` retaining only values that diverge from the manifest. The manifest seeds and is compared against these settings; the portal never writes it, so every editable field applies immediately regardless of manifest location. The rubric remains a per-season immutable version.

Schedule timestamps are epoch milliseconds. PostgreSQL stores them as `BIGINT`; Drizzle's `mode: "number"` keeps the application and API values as JavaScript numbers.

### `teams`

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Team ID |
| `name` | `TEXT NOT NULL` | Team name |
| `pathway` | `TEXT` | `junior`, `senior`, or `NULL` |
| `score` | `INTEGER` | Final score (out of 100) |
| `rank` | `INTEGER` | 1-based ranking |
| `project_name` | `TEXT NOT NULL DEFAULT ''` | Submitted project name |
| `project_description` | `TEXT NOT NULL DEFAULT ''` | Project description |
| `project_demo_url` | `TEXT` | Demo URL |
| `project_repo_url` | `TEXT` | Repository URL |
| `project_video_url` | `TEXT` | Required demonstration video URL at submission |
| `project_submitted` | `INTEGER NOT NULL DEFAULT 0` | Whether project is submitted |
| `submitted_at` | `TIMESTAMPTZ` | Set when the project is submitted |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | `active`, `withdrawn`, `disqualified`, or `no_show` |
| `score_exact` | `DOUBLE PRECISION` | Unrounded weighted score used for exact ranking |
| `owner_user_id` | `INTEGER` | FK to `users.id` (set null on delete); owner of roster controls |
| `sourcing` | `TEXT NOT NULL DEFAULT ''` | AI-use disclosure |
| `season_id` | `INTEGER NOT NULL` | FK to `seasons.id` |

### `team_scores`

Stores judge scores for each team. Each judge can score a team exactly once.

| Column | Type | Description |
| --- | --- | --- |
| `team_id` | `INTEGER NOT NULL` | FK to `teams.id` |
| `judge_user_id` | `INTEGER NOT NULL` | FK to `users.id` |
| `scores` | `TEXT NOT NULL` | JSON object of rubric scores |
| `reasoning` | `TEXT NOT NULL DEFAULT '<no reasoning provided>'` | Judge's reasoning |
| `season_id` | `INTEGER NOT NULL` | FK to `seasons.id` (restrict) |
| `rubric_version_id` | `INTEGER` | Immutable rubric version the evaluation was scored against |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Finalization time |

**Primary key**: `(team_id, judge_user_id)`

### `users`

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | User ID |
| `email` | `TEXT NOT NULL UNIQUE` | User email |
| `name` | `TEXT` | Display name |
| `team_id` | `INTEGER` | FK to `teams.id` |
| `profile_theme` | `TEXT` | Profile theme as `"mode\|value"` |
| `profile_picture` | `TEXT` | Basis-auth picture URL or legacy local asset path |
| `auth_issuer` | `TEXT` | Linked basis-auth issuer |
| `auth_subject` | `TEXT` | Linked basis-auth subject |
| `tokens_valid_after` | `BIGINT` | Backchannel logout barrier in Unix seconds; tokens with `iat` at or before it are rejected |
| `is_admin` | `INTEGER NOT NULL DEFAULT 0` | Local administrator flag; `INITIAL_ADMIN_EMAILS` elevates a listed address at creation or sign-in |

::: warning The legacy `role` column is retired. Authorization comes from the validated basis-auth `permissions` claim, the participant compatibility bundle, and the local administrator flag. :::

### `ballots`

Each user has exactly one ballot for peer voting.

| Column      | Type                         | Description                 |
| ----------- | ---------------------------- | --------------------------- |
| `id`        | `SERIAL PRIMARY KEY`         | Ballot ID                   |
| `user_id`   | `INTEGER NOT NULL`           | FK to `users.id` (unique)   |
| `reasoning` | `TEXT`                       | Voter's reasoning           |
| `submitted` | `INTEGER NOT NULL DEFAULT 0` | Whether ballot is submitted |

### `ballot_scores`

Individual project scores within a ballot. Scores must be 1–5 or null.

| Column       | Type                 | Description                            |
| ------------ | -------------------- | -------------------------------------- |
| `id`         | `SERIAL PRIMARY KEY` | Score ID                               |
| `ballot_id`  | `INTEGER NOT NULL`   | FK to `ballots.id` (ON DELETE CASCADE) |
| `project_id` | `INTEGER NOT NULL`   | FK to `teams.id`                       |
| `score`      | `INTEGER`            | 1, 2, 3, 4, 5, or NULL                 |

**Unique constraint**: `(ballot_id, project_id)`

Basis-auth access and refresh tokens are sealed into an HTTP-only cookie; they are not stored in PostgreSQL. The database contains application users and event data, not browser token sessions. Access-token revocations and logout barriers are the exception: they must survive restarts and be shared by every process.

### `revoked_access_tokens`

| Column        | Type               | Description                                           |
| ------------- | ------------------ | ----------------------------------------------------- |
| `jti`         | `TEXT PRIMARY KEY` | Revoked access-token ID                               |
| `valid_after` | `BIGINT NOT NULL`  | Unix seconds; the token is rejected at or after it    |
| `expires_at`  | `BIGINT`           | Signed token expiry in Unix seconds, used for cleanup |

Retried deliveries keep the earliest `valid_after` per `jti`. Rows are deleted after `expires_at` plus a five-minute tolerance, with a seven-day fallback for entries that have no known expiry.

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

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Season ID |
| `name` | `TEXT NOT NULL UNIQUE` | Season name |
| `is_active` | `INTEGER NOT NULL DEFAULT 0` | Only one season can be active (CHECK 0 or 1) |
| `announcement` | `TEXT` | Editable home-page announcement |
| `max_team_members` | `INTEGER NOT NULL DEFAULT 6` | Per-season roster cap, constrained to 1–20 |
| `results_published_at` | `TIMESTAMPTZ` | Set once when results are first published; a non-null value also freezes judging after publication |
| `results_snapshot` | `JSONB` | Immutable standings snapshot written at publication |

Each season stores a complete snapshot of its event settings, mirroring the `hackathon` columns by name (status, visibility switches, timestamps, theme, announcement, rubric pointer). With YAML enabled the app overlays the live configuration on the active season, saves that configuration to the outgoing season when switching or clearing the active season, and stores diverging values as live overrides. Activating a season also carries its announcement and schedule into the live overrides, so an upcoming season's message and dates appear as soon as it goes live. The nullable `rubric_version_id` points to an immutable rubric version and is set after the version exists.

Creating a season copies only the schedule, theme, and rubric from the active season; operational switches, the vote cap, the announcement, and the score curve reset to their off/default values. Publishing results sets `results_published_at` and `results_snapshot`; the snapshot captures each team's ID, name, pathway, status, displayed and exact score, rank, and submission time. Publication also writes `results_published = 1` and turns off voting and judging unless those fields were explicitly supplied in the same request.

The default `Season 1` seed omits its serial ID so PostgreSQL advances `seasons_id_seq` normally. Migration `0004` repairs the sequence for installations that already have explicitly seeded season rows and resets an empty table to generate ID 1.

When the API decides whether to expose a team's `score`/`rank`, it resolves the `show_scores`/`show_ranking` toggles from the team's **own** season (via `getScoreRankVisibilityResolver` in `server/utils/database/seasons.ts`), using live YAML for the active season. Unknown seasons keep scores and ranks private in YAML mode. This keeps past-season results governed by their own season's settings rather than the live season's.

A partial unique index ensures at most one active season:

```sql
CREATE UNIQUE INDEX idx_seasons_active ON seasons(is_active) WHERE is_active = 1;
```

PostgreSQL also constrains `seasons.status` to `not_started`, `in_progress`, `voting`, `finished`, or `paused`, so a malformed legacy value cannot make the public theme check treat a season as published.

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

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Invitation ID |
| `team_id` | `INTEGER NOT NULL` | FK to `teams.id` (ON DELETE CASCADE) |
| `email` | `TEXT NOT NULL` | Lowercased recipient address |
| `invited_by` | `INTEGER` | FK to `users.id` (ON DELETE SET NULL) |
| `token` | `TEXT UNIQUE` | SHA-256 digest of the bearer token; the raw token is returned once |
| `expires_at` | `TIMESTAMPTZ` | Expiry; migration `0016` backfilled pending rows with creation time plus seven days |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Invitation timestamp |

Teams accept at most that season's `max_team_members` members plus pending invitations. The default cap is 6 and the schema allows 1–20. Pending invitations are omitted from listings after they expire, and expired rows are deleted before a new invitation for the same email is created.

### `judge_assignments`

Optional per-season judge scope. With no rows, a judge sees every submitted project in the season except their own team and recused teams.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Assignment ID |
| `season_id` | `INTEGER NOT NULL` | FK to `seasons.id` (cascade) |
| `judge_user_id` | `INTEGER NOT NULL` | FK to `users.id` (cascade) |
| `pathway` | `TEXT` | Restrict to one track; cannot be combined with `team_id` |
| `team_id` | `INTEGER` | Restrict to one team; FK with cascade |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation time |

A unique index covers `(season_id, judge_user_id, coalesce(pathway, ''), coalesce(team_id, 0))`.

### `judge_recusals`

A judge's explicit conflict declaration. Recused teams are removed from that judge's queue and refused at scoring time.

| Column          | Type                   | Description                  |
| --------------- | ---------------------- | ---------------------------- |
| `season_id`     | `INTEGER NOT NULL`     | FK to `seasons.id` (cascade) |
| `judge_user_id` | `INTEGER NOT NULL`     | FK to `users.id` (cascade)   |
| `team_id`       | `INTEGER NOT NULL`     | FK to `teams.id` (cascade)   |
| `reason`        | `TEXT`                 | Optional explanation         |
| `created_at`    | `TIMESTAMPTZ NOT NULL` | Creation time                |

**Primary key**: `(season_id, judge_user_id, team_id)`

### `judge_flags`

One flag per season, judge, and team. Re-flagging reopens the row and refreshes its reason.

| Column          | Type                   | Description                           |
| --------------- | ---------------------- | ------------------------------------- |
| `id`            | `SERIAL PRIMARY KEY`   | Flag ID                               |
| `season_id`     | `INTEGER NOT NULL`     | FK to `seasons.id` (cascade)          |
| `team_id`       | `INTEGER NOT NULL`     | FK to `teams.id` (cascade)            |
| `judge_user_id` | `INTEGER NOT NULL`     | FK to `users.id` (cascade)            |
| `reason`        | `TEXT NOT NULL`        | Explanation shown to organizers       |
| `resolved_at`   | `TIMESTAMPTZ`          | Set when an administrator resolves it |
| `resolved_by`   | `INTEGER`              | FK to `users.id` (set null)           |
| `created_at`    | `TIMESTAMPTZ NOT NULL` | Creation time                         |

### `admin_audit_events`

Immutable record of administrative mutations. Rows are written in the same transaction as the change they describe.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Event ID |
| `actor_user_id` | `INTEGER` | FK to `users.id` (set null) |
| `action` | `TEXT NOT NULL` | Stable action name such as `team.status` or `score.delete` |
| `entity_type` | `TEXT NOT NULL` | Entity kind |
| `entity_id` | `TEXT` | Entity identifier, stored as text |
| `before` / `after` | `JSONB` | Bounded state snapshots |
| `reason` | `TEXT` | Optional operator reason |
| `request_id` | `TEXT` | Request correlation ID |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation time |

### `notifications`

One in-app notification per recipient.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Notification ID |
| `user_id` | `INTEGER NOT NULL` | FK to `users.id` (cascade) |
| `type` | `TEXT NOT NULL` | `team_invite`, `team_invite_accepted`, `results_published`, or `judge_flag` |
| `title` | `TEXT NOT NULL` | Display title |
| `body` | `TEXT` | Optional detail |
| `link` | `TEXT` | Optional relative link |
| `read_at` | `TIMESTAMPTZ` | Read timestamp |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation time |

The list index is `(user_id, created_at)`.

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

### `rubric_templates`

Reusable rubric definitions that administrators can copy into a season. Names are unique case-insensitively.

| Column        | Type                   | Description                            |
| ------------- | ---------------------- | -------------------------------------- |
| `id`          | `SERIAL PRIMARY KEY`   | Template ID                            |
| `name`        | `TEXT NOT NULL`        | Display name, unique per `lower(name)` |
| `description` | `TEXT`                 | Optional description                   |
| `definition`  | `JSONB NOT NULL`       | Complete `RubricDefinition`            |
| `created_by`  | `INTEGER`              | FK to `users.id` (ON DELETE SET NULL)  |
| `created_at`  | `TIMESTAMPTZ NOT NULL` | Creation time                          |
| `updated_at`  | `TIMESTAMPTZ NOT NULL` | Last update time                       |

### `rubric_versions`

Immutable per-season rubric snapshots. A finalized score keeps the version it was judged against.

| Column               | Type                   | Description                                      |
| -------------------- | ---------------------- | ------------------------------------------------ |
| `id`                 | `SERIAL PRIMARY KEY`   | Version ID                                       |
| `season_id`          | `INTEGER NOT NULL`     | FK to `seasons.id` (ON DELETE RESTRICT)          |
| `version`            | `INTEGER NOT NULL`     | 1-based version within the season                |
| `name`               | `TEXT NOT NULL`        | Version name                                     |
| `definition`         | `JSONB NOT NULL`       | Frozen `RubricDefinition`                        |
| `source_template_id` | `INTEGER`              | FK to `rubric_templates.id` (ON DELETE SET NULL) |
| `created_by`         | `INTEGER`              | FK to `users.id` (ON DELETE SET NULL)            |
| `created_at`         | `TIMESTAMPTZ NOT NULL` | Creation time                                    |

**Unique index**: `(season_id, version)`

### `judging_drafts`

Autosaved judge work that has not been finalized. One row per judge and team.

| Column              | Type                   | Description                                     |
| ------------------- | ---------------------- | ----------------------------------------------- |
| `team_id`           | `INTEGER NOT NULL`     | FK to `teams.id` (ON DELETE CASCADE)            |
| `judge_user_id`     | `INTEGER NOT NULL`     | FK to `users.id` (ON DELETE CASCADE)            |
| `rubric_version_id` | `INTEGER NOT NULL`     | FK to `rubric_versions.id` (ON DELETE RESTRICT) |
| `scores`            | `JSONB NOT NULL`       | Criterion scores keyed by criterion ID          |
| `reasoning`         | `TEXT NOT NULL`        | Draft comment (default `''`)                    |
| `updated_at`        | `TIMESTAMPTZ NOT NULL` | Last autosave                                   |

**Primary key**: `(team_id, judge_user_id)`

### `sc_votes`

Legacy ballot rows retained by the SQLite importer for audit and history. The application does not read or write them for voting.

| Column         | Type      | Description                           |
| -------------- | --------- | ------------------------------------- |
| `id`           | `SERIAL`  | Row ID                                |
| `user_id`      | `INTEGER` | FK to `users.id` (ON DELETE SET NULL) |
| `vote`         | `TEXT`    | Original legacy payload               |
| `submitted_at` | `INTEGER` | Original submission time              |

### `asset_objects`

Content-addressed registry of managed uploads, used to deduplicate files and to collect unreferenced ones after the grace period.

| Column | Type | Description |
| --- | --- | --- |
| `collection` | `TEXT NOT NULL` | `assets` or `userassets` |
| `asset_path` | `TEXT NOT NULL` | Path relative to the collection root |
| `sha256` | `TEXT NOT NULL` | Content hash, 64 lowercase hex characters |
| `byte_size` | `BIGINT NOT NULL` | Stored size in bytes |
| `pinned` | `BOOLEAN NOT NULL` | Pinned objects are never collected |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation time |
| `unreferenced_at` | `TIMESTAMPTZ` | When the last reference was released; starts the grace period |

**Primary key**: `(collection, asset_path)`. Check constraints enforce the collection name, the hash format, a non-negative size, and the content-addressed path shape.

### `asset_references`

Active permalink references to a stored object. Releasing the last reference sets `asset_objects.unreferenced_at`; cleanup waits at least seven days and re-checks the database under a lock.

| Column           | Type                   | Description                           |
| ---------------- | ---------------------- | ------------------------------------- |
| `id`             | `TEXT PRIMARY KEY`     | Reference ID                          |
| `collection`     | `TEXT NOT NULL`        | Collection of the referenced object   |
| `asset_path`     | `TEXT NOT NULL`        | Path of the referenced object         |
| `reference_type` | `TEXT NOT NULL`        | Only `permalink` is allowed           |
| `created_by`     | `INTEGER`              | FK to `users.id` (ON DELETE SET NULL) |
| `created_at`     | `TIMESTAMPTZ NOT NULL` | Creation time                         |

**Foreign key**: `(collection, asset_path)` to `asset_objects` with `ON DELETE CASCADE`.

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

### Request-scoped caching and batching

`requestCache(event, key, load)` memoizes a lookup in a `WeakMap` keyed by the H3 event, so it cannot leak across requests. Failed lookups are evicted for retry, and `invalidateRequestCaches(event)` clears the scope after a write the request reads back. Sharing one lookup across a request avoids repeated active-season, rubric, and visibility queries.

List endpoints use keyset pagination where growth would otherwise materialize every row. `GET /api/teams` and `GET /api/judging/history/:seasonId` accept optional `limit` (1–50) and `after`, and return `next_cursor` when `limit` is supplied. Without `limit`, they keep the original full-array response.

Scoring batches standings writes into chunks of 250 and persists each chunk with one `UPDATE ... FROM (VALUES ...)` statement, avoiding a separate update per team. Exact scores, the highest-weight rubric criterion, submission time, and team ID provide a deterministic order; equal results share a competition rank, and non-active teams receive no rank.

### Concurrency and locks

Timed and judged writes take row locks through `lockForUpdateIfSupported`, and season-wide operations serialize through PostgreSQL advisory locks. Season activation, migration startup, and asset lifecycle cleanup use advisory locks so concurrent processes cannot interleave. `team_scores` carries a composite foreign key to `teams(id, season_id)`, so a score cannot point across seasons.

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
| `seasons.ts` | `getSeasons`, `getSeasonById`, `getActiveSeason`, `setActiveSeason`, `getScoreRankVisibilityResolver` |
| `awards.ts` | `getAwards`, `getAwardsForTeams`, `createAward`, `deleteTeamAwards`, `deleteAward` |
| `judge-flags.ts` | `upsertJudgeFlag`, `resolveJudgeFlag`, `getJudgeFlags` |
| `query.ts` | `firstRow`, `changedRows`, `lockForUpdateIfSupported`, `requestCache`, `invalidateRequestCaches`, `isUniqueViolation` |
| `members.ts` | `getTeamMemberLimit`, invite creation/acceptance by ID or token, ownership transfer, disband |

## Type Conventions

TypeScript types in `shared/database.d.ts` must stay in sync with the SQL schema. These types represent raw database rows:

```ts
interface User {
    id: number;
    email: string;
    name: string | null;
    team_id: number | null;
    profile_theme: string | null;
    profile_picture: string | null;
    auth_issuer: string | null;
    auth_subject: string | null;
    is_admin: number;
}
```

API response types in `shared/responses.d.ts` represent the public-facing shape after conversion:

```ts
interface APIUser {
    id: number;
    email: string;
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

Apply pending migrations explicitly during release workflows with `bun run db:migrate`. Nitro also applies them at startup before it serves requests. `server/database/migrate.ts` opens a pinned connection, sets `statement_timeout = 0`, and takes a PostgreSQL advisory transaction lock while Drizzle applies its migrations. Concurrent starts therefore serialize, and a legitimate large DDL batch is not aborted by the ordinary 15-second statement timeout. The pool needs at least two connections for the lock and migration session. Keep schema changes and generated migration SQL in the same change.

`0015` adds the audit, assignment, recusal, and notification tables; backfills `team_scores.season_id` and team ownership; normalizes boolean columns and duplicate names; and adds the new columns, indexes, foreign keys, and check constraints. `0016` adds `judge_flags`, `seasons.max_team_members`, invitation `token`/`expires_at`, and `teams.project_video_url`, backfills invitation expiry from creation time, and validates the roster cap. The SQLite importer uses a five-second `lock_timeout` before taking the same advisory lock.

## SQLite import

SQLite is a source format for the one-time VPS cutover only. The importer is read-only against its SQLite backup, accepts an empty PostgreSQL target or the complete exact seed created by fresh migrations, and executes the import in one transaction. Partial or modified seed state and other target data are rejected. It preserves IDs and relationships, sets PostgreSQL identity sequences, checks row counts and foreign-key references, and writes the legacy-only columns and old score migration artifact to `sqlite_legacy_data`.

JSON columns are normalized before binding: a SQLite TEXT value that already contains JSON is parsed so PostgreSQL stores an object, and a plain string stays a JSON string. Season status values are validated against the allowed set, and a score is assigned to its team's season even when a legacy `season_id` disagrees, so scoring and feedback always read the same rows.

Run a source-only check with `bun run db:import-sqlite:check`, then apply with `bun run db:import-sqlite -- --confirm`. See [PostgreSQL and VPS deployment](/deployment/postgresql-migration) for backup, maintenance-window, and rollback steps.

## Foreign keys and transactions

PostgreSQL enforces relationships declared in the Drizzle schema. Use transactions for operations that update related rows, and preserve the configured `ON DELETE` behavior when changing relationship constraints. The importer checks both the source's references and the target's referential integrity before committing.

`team_scores` carries a composite foreign key to `teams(id, season_id)`, so a score cannot be stored against a team from a different season. Deleting the last member of a team is blocked with `409`; an administrator must delete the team explicitly first, keeping every remaining team manageable.

All ordinary application reads and writes should use Drizzle's parameterized query builders. Use the documented migration runner for schema changes; do not issue ad hoc production schema changes outside a reviewed migration.
