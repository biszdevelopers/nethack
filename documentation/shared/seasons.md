---
title: Seasons
description: Database-driven hackathon seasons, per-season configuration, and score/rank visibility.
---

# Seasons

Hackathon seasons are stored entirely in the database. Each season carries its own copy of every hackathon configuration field, so organizers can preview and tune a future season without touching the live event. Teams are linked to a season via the `season_id` foreign key.

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
| `start_timestamp` / `end_timestamp` | integer | Unix timestamps (ms) |
| `voting_start_timestamp` / `voting_end_timestamp` | integer | Voting window (ms) |
| `results_open_timestamp` | integer | When results become visible (ms) |
| `theme_name` / `theme_description` | text | Season theme |

The `hackathon` table remains a singleton (`id = 1`) holding the **live** state. The admin page shows a merged view — global values with the selected season's non-default overrides layered on top. Saving with a `season_id` writes to that season's row (and to the global row when the season is active); saving without one writes only to the global row.

## Tweakable Settings

`SEASON_TWEAK_FIELDS` in `server/utils/database/seasons.ts` defines the fields that sync between a season and the live `hackathon` row: `status`, `show_scores`, `show_ranking`.

- `updateSeasonTweaks` updates a season, and also the `hackathon` row when the season is the active one.
- `setActiveSeason` copies the newly active season's tweaks into the `hackathon` row when a season is activated.

## Score / Rank Visibility

`getScoreRankVisibilityResolver(event)` returns a resolver mapping a season ID to `{ showScores, showRanking }`. Each season's own tweaks are authoritative for its teams; teams whose season no longer exists fall back to the live `hackathon` singleton row.

Published judge feedback is available to current and past members of the evaluated team only after `results_published` is enabled. Score details follow `show_scores`, while rank follows `show_ranking`. Feedback omits judge identifiers and randomizes evaluation order. Administrators with the all-permissions grant can inspect the full feedback before publication. Judge names and account IDs are omitted in both participant and administrator views.

`score_curve_preset` affects the displayed score returned to participants; it never changes persisted judge evaluations, the computed uncurved average, or rankings. The presets are `original` (unchanged), `gentle`, `moderate`, and `strong`; configure the season in the administration UI.

## API Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/seasons` | `PORTAL_SEASONS_VIEW` or admin | List all database seasons |
| GET | `/api/seasons/active` | None | Get the active season merged with the global hackathon state |
| PATCH | `/api/seasons/active` | `PORTAL_SEASONS_EDIT` or admin | Set the active season |
| GET | `/api/seasons/:id/tweaks` | `PORTAL_SEASONS_VIEW` or admin | Get a season's tweakable settings |
| PATCH | `/api/seasons/:id/tweaks` | `PORTAL_SEASONS_EDIT` or admin | Update a season's tweakable settings |
| PATCH | `/api/admin/seasons/:id/score-curve` | Season update permission | Set that season's score display curve |
| GET | `/api/teams/:id/scores` | Current or past team member | Read anonymous feedback after results are published |
| GET | `/api/admin/teams/:id/scores` | Admin with the all-permissions grant | Read full team score feedback, including before publication; judge identities remain hidden |

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
| `updateSeasonTweaks(event, seasonId, data)` | Update a season's tweaks; also updates the `hackathon` row when the season is live |
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
