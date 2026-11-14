---
title: TypeScript Types
description: Database row types and API response interfaces
---

# TypeScript Types

The shared type definitions ensure type safety across the frontend and backend. Database types mirror the SQL schema exactly, while API response types define the public contract.

::: info Source Files

- `shared/database.d.ts` — Database row types
- `shared/responses.d.ts` — API response interfaces
- `shared/auth.d.ts` — basis-auth token session type augmentation :::

## Type Unions

### `HackathonStatus`

```ts
type HackathonStatus =
    | "not_started" // before the event
    | "in_progress" // during the event
    | "voting" // after the event, peer voting
    | "finished" // event completed
    | "paused"; // event paused for maintenance, etc.
```

The live YAML manifest uses the same fields as the legacy `hackathon` singleton. Its `status` field controls the global event state.

### `TeamPathway`

```ts
type TeamPathway = "junior" | "senior";
```

Teams are categorized into two pathways with different rubric weightings.

---

## Database Row Interfaces

These interfaces match the SQL schema exactly. They include all columns, including internal fields not exposed in API responses.

### `Hackathon`

| Field                    | Type              | Description                            |
| ------------------------ | ----------------- | -------------------------------------- |
| `id`                     | `1`               | Literal `1` — single-row table         |
| `status`                 | `HackathonStatus` | Current event state                    |
| `voting_enabled`         | `number`          | Whether peer voting is open (0 or 1)   |
| `results_published`      | `number`          | Whether results are published (0 or 1) |
| `submitted_count`        | `number`          | Number of submitted projects           |
| `max_votes_per_user`     | `number`          | Maximum peer votes per user            |
| `judging_open`           | `number`          | Whether judge scoring is open (0 or 1) |
| `schedule_start`         | `string \| null`  | Scheduled start time                   |
| `schedule_end`           | `string \| null`  | Scheduled end time                     |
| `start_timestamp`        | `number`          | Actual start timestamp                 |
| `end_timestamp`          | `number`          | Actual end timestamp                   |
| `voting_start_timestamp` | `number`          | Voting period start                    |
| `voting_end_timestamp`   | `number`          | Voting period end                      |
| `results_open_timestamp` | `number`          | Results visibility timestamp           |
| `theme_name`             | `string \| null`  | Hackathon theme name                   |
| `theme_description`      | `string \| null`  | Hackathon theme description            |

### `Team`

| Field                 | Type                  | Description                           |
| --------------------- | --------------------- | ------------------------------------- |
| `id`                  | `number`              | Primary key                           |
| `name`                | `string`              | Team name                             |
| `pathway`             | `TeamPathway \| null` | Junior or senior pathway              |
| `score`               | `number \| null`      | Final weighted score                  |
| `rank`                | `number \| null`      | Final rank                            |
| `project_name`        | `string`              | Project name                          |
| `project_description` | `string`              | Project description                   |
| `project_demo_url`    | `string \| null`      | Demo URL                              |
| `project_repo_url`    | `string \| null`      | Repository URL                        |
| `project_submitted`   | `number`              | Whether project is submitted (0 or 1) |
| `sourcing`            | `string`              | AI/tooling sourcing disclosure        |
| `season_id`           | `number`              | Foreign key to season                 |

### `TeamScores`

| Field           | Type     | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `team_id`       | `number` | Foreign key to team                          |
| `judge_user_id` | `number` | Foreign key to judge user                    |
| `scores`        | `string` | JSON string of rubric scores                 |
| `reasoning`     | `string` | Judge's written reasoning                    |
| `season_id`     | `number` | Optional season context for the scored entry |

### `User`

| Field             | Type             | Description                                       |
| ----------------- | ---------------- | ------------------------------------------------- |
| `id`              | `number`         | Primary key                                       |
| `email`           | `string`         | User email (`@basischina.com`)                    |
| `role`            | `string`         | Space-separated URI-encoded permission strings    |
| `name`            | `string \| null` | Display name                                      |
| `team_id`         | `number \| null` | Foreign key to team                               |
| `profile_theme`   | `string \| null` | Profile theme as `"mode\|value"` string           |
| `profile_picture` | `string \| null` | Basis-auth picture URL or legacy local asset path |

### `Ballot`

| Field       | Type             | Description                          |
| ----------- | ---------------- | ------------------------------------ |
| `id`        | `number`         | Primary key                          |
| `user_id`   | `number`         | Foreign key to user                  |
| `reasoning` | `string \| null` | Voter's written reasoning            |
| `submitted` | `number`         | Whether ballot is submitted (0 or 1) |

### `BallotScore`

| Field        | Type                            | Description                   |
| ------------ | ------------------------------- | ----------------------------- |
| `id`         | `number`                        | Primary key                   |
| `ballot_id`  | `number`                        | Foreign key to ballot         |
| `project_id` | `number`                        | Foreign key to team (project) |
| `score`      | `1 \| 2 \| 3 \| 4 \| 5 \| null` | Star rating (1–5) or null     |

### `OAuth2Application`

| Field             | Type             | Description                                 |
| ----------------- | ---------------- | ------------------------------------------- |
| `client_id`       | `string`         | UUID client identifier                      |
| `client_secret`   | `string`         | Space-separated SHA-256 hashes              |
| `redirect_uris`   | `string \| null` | Space-separated allowed redirect URIs       |
| `permissions`     | `string \| null` | Space-separated allowed OAuth2 scopes       |
| `name`            | `string`         | Application display name                    |
| `description`     | `string \| null` | Application description                     |
| `type`            | `string \| null` | First-party or third-party application type |
| `profile_picture` | `string \| null` | Application icon path                       |
| `owner_id`        | `number \| null` | Foreign key to owning user                  |

### `Award`

Award definitions are stored in the `awards` table.

| Field         | Type     | Description                        |
| ------------- | -------- | ---------------------------------- |
| `namespace`   | `string` | Unique machine-readable identifier |
| `name`        | `string` | Award display name                 |
| `description` | `string` | Award description                  |
| `icon`        | `string` | Iconify icon class                 |
| `color`       | `string` | Display color (defaults to `gold`) |

### `TeamAward`

Per-team assignments are stored in `team_awards`.

| Field     | Type     | Description                                |
| --------- | -------- | ------------------------------------------ |
| `team_id` | `number` | Foreign key to team                        |
| `award`   | `string` | Award namespace from `awards.namespace`    |
| `meta`    | `string` | JSON metadata stored as a non-empty string |

### `PeerVotingScore`

| Field       | Type     | Description                            |
| ----------- | -------- | -------------------------------------- |
| `user_id`   | `number` | Foreign key to user                    |
| `score`     | `string` | JSON string of peer-voting allocations |
| `reasoning` | `string` | Voter's written reasoning              |

### `Season`

| Field       | Type     | Description                            |
| ----------- | -------- | -------------------------------------- |
| `id`        | `number` | Primary key                            |
| `name`      | `string` | Season display name                    |
| `is_active` | `number` | Whether this season is active (0 or 1) |

### `UserPastTeams`

| Field     | Type     | Description              |
| --------- | -------- | ------------------------ |
| `user_id` | `number` | Foreign key to user      |
| `team_id` | `number` | Foreign key to past team |

---

## API Response Interfaces

These types define domain values returned inside `APIResponse.data`. Internal fields are stripped by `convertUserToPublic` and `convertTeamToPublic` in `server/utils/convert.ts`; the transport envelope itself comes from `@basis/schema`.

### `ProfileTheme`

```ts
interface ProfileTheme {
    mode: "url" | "emoji" | "gradient";
    value: string;
}
```

Parsed from the database `"mode|value"` string format.

### `APIUser`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `number` | User ID |
| `email` | `string` (optional) | Included only in authorized self/admin responses |
| `name` | `string \| null` | Display name |
| `team_id` | `number \| null` (optional) | Included only in authorized self/admin responses |
| `profile_theme` | `ProfileTheme \| null` | Parsed profile theme |
| `profile_picture` | `string \| null` | Basis-auth picture URL or legacy local asset path |

Public lookups by another user's ID omit both `email` and `team_id` to prevent contact and roster enumeration. Roles are not part of this public response.

### `APITeam`

| Field                 | Type                  | Description                    |
| --------------------- | --------------------- | ------------------------------ |
| `id`                  | `number`              | Team ID                        |
| `name`                | `string`              | Team name                      |
| `pathway`             | `TeamPathway \| null` | Junior or senior               |
| `rank`                | `number \| null`      | Final rank                     |
| `score`               | `number \| null`      | Final weighted score           |
| `season_id`           | `number`              | Season ID                      |
| `project.name`        | `string`              | Project name                   |
| `project.description` | `string`              | Project description            |
| `project.demo_url`    | `string \| null`      | Demo URL                       |
| `project.repo_url`    | `string \| null`      | Repository URL                 |
| `project.submitted`   | `boolean`             | Whether project is submitted   |
| `project.sourcing`    | `string`              | AI/tooling sourcing disclosure |
| `awards`              | `APIAward[]`          | Resolved team awards           |

### `APIAward`

| Field         | Type                      | Description                               |
| ------------- | ------------------------- | ----------------------------------------- |
| `namespace`   | `string`                  | Award namespace from the `awards` table   |
| `name`        | `string`                  | Award display name                        |
| `description` | `string`                  | Award description                         |
| `icon`        | `string`                  | Icon class                                |
| `meta`        | `Record<string, unknown>` | Parsed JSON metadata from `team_awards`   |
| `color`       | `string`                  | Resolved award color (defaults to `gold`) |
| `text`        | `string`                  | Award description                         |

Awards are resolved by joining `team_awards` with the `awards` table, then attached to `APITeam` by `convertTeamToPublic`.

### `GetUserResponse`

Extends `APIUser` with team information:

| Field                  | Type              | Description                 |
| ---------------------- | ----------------- | --------------------------- |
| _(all APIUser fields)_ |                   | Inherited                   |
| `team`                 | `APITeam \| null` | User's current team         |
| `past_teams`           | `APITeam[]`       | Teams from previous seasons |

### `GetTeamResponse`

Extends `APITeam` (no additional fields, but typed as a distinct interface for future extensibility).

### `CreateTeamResponse`

```ts
type CreateTeamResponse = APITeam;
```

### `GetTeamMembersResponse`

```ts
type GetTeamMembersResponse = {
    id: number;
    email: string;
    name: string | null;
    team_id: number | null;
}[];
```

An array of lightweight member objects.

### `UpdateUserResponse`

| Field     | Type     | Description     |
| --------- | -------- | --------------- |
| `message` | `string` | Success message |

### `GetBallotResponse`

| Field       | Type             | Description                                        |
| ----------- | ---------------- | -------------------------------------------------- |
| `submitted` | `boolean`        | Whether the user has already submitted a peer vote |
| `projects`  | `APITeam[]`      | Eligible projects to vote on                       |
| `scores`    | `number[]`       | Star ratings parallel to `projects`                |
| `reasoning` | `string \| null` | Voter's reasoning                                  |

### `BallotSummaryItem`

| Field             | Type     | Description                    |
| ----------------- | -------- | ------------------------------ |
| `season_id`       | `number` | Season ID                      |
| `season_name`     | `string` | Season display name            |
| `project_count`   | `number` | Total projects in the season   |
| `submitted_count` | `number` | Submitted projects             |
| `scored_count`    | `number` | Projects that have been judged |

### `GetBallotSummaryResponse`

| Field     | Type                        | Description                   |
| --------- | --------------------------- | ----------------------------- |
| `current` | `BallotSummaryItem \| null` | Summary for the active season |
| `past`    | `BallotSummaryItem[]`       | Summaries for past seasons    |

### `ElectionCandidate`

| Field       | Type     | Description         |
| ----------- | -------- | ------------------- |
| `id`        | `string` | Candidate ID        |
| `shortName` | `string` | Ballot display name |
| `fullName`  | `string` | Official full name  |
| `email`     | `string` | School email        |

### `ElectionPosition`

| Field        | Type                  | Description                 |
| ------------ | --------------------- | --------------------------- |
| `title`      | `string`              | Position title              |
| `candidates` | `ElectionCandidate[]` | Candidates for the position |

### `ElectionResult`

| Field          | Type                                     | Description             |
| -------------- | ---------------------------------------- | ----------------------- |
| `totalBallots` | `number`                                 | Number of cast ballots  |
| `positions`    | `{ title, status, winner?, details? }[]` | Per-position IRV result |

### `ElectionBallot`

| Field          | Type                             | Description          |
| -------------- | -------------------------------- | -------------------- |
| `id`           | `number`                         | Ballot record ID     |
| `user_id`      | `number`                         | Voter user ID        |
| `name`         | `string \| null`                 | Voter name           |
| `email`        | `string \| null`                 | Voter email          |
| `submitted_at` | `number \| null`                 | Submission timestamp |
| `vote`         | `Record<string, number \| null>` | Candidate ID → rank  |

---

## Browser-safe authentication state

`useBasisAuthSession()` exposes the browser-safe user ID, token expiry, and permission list returned by `GET /api/auth/session`. It never exposes access or refresh token values. Protected API requests independently validate the token from the HTTP-only cookie or a bearer header, then load the complete user record from PostgreSQL.
