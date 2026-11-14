---
title: Seasons
description: Database-driven hackathon seasons, per-season configuration, and score/rank visibility.
---

# Seasons

Hackathon season records are stored in PostgreSQL. The active season's effective live settings come from `HACKATHON.yml`. Each season carries its own copy of every hackathon configuration field, so organizers can preview and tune a future season without touching the live event. Teams are linked to a season via the `season_id` foreign key.

## Season Storage

The `seasons` table stores the season name, its active state, and a full per-season copy of the hackathon configuration:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key |
| `name` | text | Display name |
| `is_active` | integer | `1` for the single active season (partial unique index) |
| `status` | text | `not_started`, `in_progress`, `voting`, `finished`, `paused` |
| `voting_enabled` | integer | Toggle peer voting |
| `judging_open` | integer | Toggle judge scoring |
| `results_published` | integer | Publish results to participants |
| `show_scores` | integer | Show scores to participants |
| `show_ranking` | integer | Show rankings to participants |
| `score_curve_preset` | text | Presentation curve: `original`, `gentle`, `moderate`, or `strong` |
| `max_votes_per_user` | integer | Cap on peer votes per user |
| `schedule_start` / `schedule_end` | text | Display dates |
| `start_timestamp` / `end_timestamp` | bigint in PostgreSQL; JavaScript `number` | Epoch milliseconds |
| `voting_start_timestamp` / `voting_end_timestamp` | bigint in PostgreSQL; JavaScript `number` | Voting window in epoch milliseconds |
| `results_open_timestamp` | bigint in PostgreSQL; JavaScript `number` | When results become visible, in epoch milliseconds |
| `theme_name` / `theme_description` | text | Season theme |

The live state comes from the selected YAML manifest. In YAML mode the admin page shows live settings as read-only and keeps other seasons editable. The legacy singleton remains available for PostgreSQL rollback mode.

## Tweakable Settings

`SEASON_TWEAK_FIELDS` in `server/utils/database/seasons.ts` defines the fields that sync in rollback mode between a season and the live `hackathon` row: `status`, `show_scores`, `show_ranking`.

- `updateSeasonTweaks` updates stored settings and rejects active-season edits in YAML mode.
- `setActiveSeason` snapshots the outgoing season's live YAML settings before changing the active season.

## Score / Rank Visibility

`getScoreRankVisibilityResolver(event)` returns a resolver mapping a season ID to `{ resultsPublished, showScores, showRanking }`. The active season uses live YAML settings and other seasons use their stored settings. Unknown seasons keep results private in YAML mode.

Judge comments are available to current and past team members only after `results_published` is enabled and at least three judges have submitted evaluations for that team. Until then, the endpoint withholds all comments and individual score details to reduce the chance of identifying a judge. Public feedback returns only comment text and randomizes evaluation order; it omits judge identities and rubric or track metadata. Administrators with the all-permissions grant can inspect full evaluations, including judge names and account IDs, before or after publication. Participants see the overall score only when results are published, at least three evaluations exist, and `show_scores` is enabled; rank requires published results, at least three evaluations, and `show_ranking`.

`score_curve_preset` affects the displayed score returned to participants; it never changes persisted judge evaluations, the computed uncurved average, or rankings. The presets are `original` (unchanged), `gentle`, `moderate`, and `strong`; configure the season in the administration UI.

## API Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/seasons` | Public, read-only | List safe season details; unreleased themes are redacted |
| GET | `/api/seasons/active` | None | Get the active season merged with the global hackathon state |
| PATCH | `/api/seasons/active` | `PORTAL_SEASONS_EDIT` or admin | Set the active season |
| GET | `/api/seasons/:id/tweaks` | Public, read-only | Get safe public season details; unreleased themes and organizer-only fields are hidden |
| PATCH | `/api/seasons/:id/tweaks` | `PORTAL_SEASONS_EDIT` or admin | Update a season's tweakable settings |
| PATCH | `/api/admin/seasons/:id/score-curve` | Season update permission | Set that season's score display curve |
| GET | `/api/teams/:id/scores` | Current or past team member | Read anonymous comments after publication and at least three evaluations |
| GET | `/api/admin/teams/:id/scores` | Admin with the all-permissions grant | Read full team score feedback, including judge identities, before or after publication |

For both season-tweaks routes, the `id` must be a positive safe integer. Missing or malformed IDs return `400`; a valid ID for a season that does not exist returns `404`. The public `GET` response uses the `PublicSeason` allowlist and redacts theme values while a season has not started or is paused.

`GET /api/seasons/active` returns the active season record together with the global `hackathon` state, including `status`, `start_timestamp`, `end_timestamp`, `voting_start_timestamp`, `voting_end_timestamp`, `results_open_timestamp`, `theme_name`, and `theme_description`. Theme fields are hidden when the hackathon status is `not_started` or `paused`.

`PATCH /api/seasons/active` accepts `SetActiveSeasonRequest`:

```ts
{
    season_id: number | null;
}
```

Passing `null` deactivates all seasons.

`PATCH /api/seasons/:id/tweaks` accepts `UpdateSeasonTweaksRequest`:

```ts
{
    status?: "not_started" | "in_progress" | "voting" | "finished" | "paused";
    show_scores?: boolean;
    show_ranking?: boolean;
}
```

At least one field is required. Boolean values are stored as `0`/`1`.

## Database Helpers

`server/utils/database/seasons.ts` provides:

| Function | Description |
| --- | --- |
| `getSeasons(event)` | List all seasons ordered by ID |
| `getSeasonById(event, seasonId)` | Get a season by ID |
| `getActiveSeason(event)` | Get the currently active season |
| `setActiveSeason(event, seasonId)` | Activate one season and deactivate all others; throws 404 if the season does not exist |
| `updateSeasonTweaks(event, seasonId, data)` | Update stored tweaks. Live edits are rejected in YAML mode. |
| `getScoreRankVisibilityResolver(event)` | Build a season-ID-to-visibility resolver with a global fallback |

## Usage in the UI

- The home page (`/`) fetches the active season to display the theme, date, and schedule.
- The dashboard sidebar shows the active season's theme and date.
- The results page (`/dashboard/results`) uses `ScoreCard`, which reads season configuration to decide whether scores and ranks are visible.
- The Hackathon Administration page (`/developers/season`) manages seasons and their per-season configuration.

## Source Files

- `server/database/schema.ts` — `seasons` table definition
- `shared/schemas.ts` — `SetActiveSeasonRequest`, `UpdateSeasonTweaksRequest`
- `server/utils/database/seasons.ts` — database helpers
- `server/api/seasons/index.get.ts`
- `server/api/seasons/active.get.ts`
- `server/api/seasons/active.patch.ts`
- `server/api/seasons/[id]/tweaks.get.ts`
- `server/api/seasons/[id]/tweaks.patch.ts`
- `app/pages/developers/season.vue` — Hackathon Administration page
