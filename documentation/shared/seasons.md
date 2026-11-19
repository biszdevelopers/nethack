---
title: Seasons
description: Database-driven hackathon seasons, per-season configuration, and score/rank visibility.
---

# Seasons

Hackathon season records are stored in PostgreSQL. The active season's effective live settings come from PostgreSQL. Each season carries its own copy of every hackathon configuration field, so organizers can preview and tune a future season without touching the live event. Teams are linked to a season via the `season_id` foreign key.

## Season Storage

The `seasons` table stores the season name, its active state, and a full per-season copy of the hackathon configuration:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key |
| `name` | text | Display name |
| `is_active` | integer | `1` for the single active season (partial unique index) |
| `status` | text | `not_started`, `in_progress`, `voting`, `finished`, `paused` |
| `voting_enabled` | integer | Toggle peer voting; open whenever this flag is `1` and the event is not `paused` |
| `judging_open` | integer | Toggle judge scoring; open whenever this flag is `1` and the event is not `paused` |
| `results_published` | integer | Publish results to participants |
| `show_scores` | integer | Show scores to participants |
| `show_ranking` | integer | Show rankings to participants |
| `score_curve_preset` | text | Presentation curve: `original`, `gentle`, `moderate`, or `strong` |
| `max_votes_per_user` | integer | Maximum projects that may receive stars per ballot; `0` means unlimited |
| `schedule_start` / `schedule_end` | text | Display dates |
| `start_timestamp` / `end_timestamp` | bigint in PostgreSQL; JavaScript `number` | Epoch milliseconds |
| `voting_start_timestamp` / `voting_end_timestamp` | bigint in PostgreSQL; JavaScript `number` | Voting window in epoch milliseconds |
| `results_open_timestamp` | bigint in PostgreSQL; JavaScript `number` | When results become visible, in epoch milliseconds |
| `theme_name` / `theme_description` | text | Season theme |
| `announcement` | text | Admin-editable home-page announcement for the season |

All live state, announcements, and rubrics come from PostgreSQL. Admin edits update the active season and live singleton transactionally; inactive seasons retain independently editable settings.

Creating a season copies the live event settings and the active season's score display curve, and activating a season that was never configured seeds it from the live settings first, so switching seasons cannot blank the theme, schedule, or status. Activating a settings-copy season with no rubric materializes an immutable copy of the active season's rubric version before the switch, so submissions and judging are not left without a rubric.

## Tweakable Settings

`SEASON_TWEAK_FIELDS` in `server/utils/database/seasons.ts` defines the fields that synchronize between the active season and the live `hackathon` row: `status`, `show_scores`, `show_ranking`.

- `updateSeasonTweaks` updates stored settings and synchronizes the live singleton for the active season.
- `setActiveSeason` applies the selected season's complete stored settings in the same PostgreSQL transaction as activation.

## Score / Rank Visibility

`getScoreRankVisibilityResolver(event)` returns a resolver mapping a season ID to `{ resultsPublished, showScores, showRanking }`. Each season uses its stored PostgreSQL settings. Unknown or unspecified season IDs fall back to the live singleton settings.

The dev-portal toggles are authoritative: `isJudgingOpen` and `isVotingOpen` depend only on their respective switch, and the explicit `paused` maintenance state is the sole override. The event phase does not silently veto a toggle, and publishing results does not close judging. Because judging can remain open after publication by explicit choice, a new evaluation can change the persisted public score and rank; turn `judging_open` off when the ranking must freeze. Judge comments are available to current and past team members only after `results_published` is enabled and at least three judges have submitted evaluations for that team. Until then, the endpoint withholds all comments and individual score details to reduce the chance of identifying a judge. Public feedback returns only comment text and randomizes evaluation order; it omits judge identities and rubric or track metadata. Administrators with the all-permissions grant can inspect full evaluations, including judge names and account IDs, before or after publication. Participants see the overall score only when results are published, at least three evaluations exist, and `show_scores` is enabled; rank requires published results, at least three evaluations, and `show_ranking`.

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

`GET /api/seasons/active` returns the active season record together with the global `hackathon` state, including `status`, `start_timestamp`, `end_timestamp`, `voting_start_timestamp`, `voting_end_timestamp`, `results_open_timestamp`, `theme_name`, `theme_description`, and `announcement`. It also returns the server-computed gates `is_judging_open` (the `judging_open` toggle is on and the event is not `paused`) and `is_voting_open` (voting is enabled and the event is not `paused`), so the judging and voting UIs never duplicate the conditions their APIs enforce. The portal toggles are authoritative: the event phase and published-results flag do not silently veto them, so each switch always dictates its effective state. Theme fields are hidden when the hackathon status is `not_started` or `paused`; the announcement is always returned so organizers can publish preparation news before an event starts.

`PATCH /api/seasons/active` accepts `SetActiveSeasonRequest`:

```ts
{
    season_id: number | null;
}
```

Passing `null` deactivates all seasons.

Startup creates the inactive `Next season` shell with switches disabled, empty schedule and theme fields, no rubric, and no board approval record. Older targets that still contain the legacy `R1 2026–2027` shell are recognized by the SQLite importer as the same pristine seed state. The administration page preserves its settings-copy option and also provides a blank-season option. Activation is rejected with `409 season_not_ready` until the season has a theme, event and voting dates, its own rubric version, and recorded board approval. An administrator records or revokes approval in the season manager; the record stores the admin user ID and timestamp. Approval cannot be revoked while a blank-start season is active. Activation never seeds a blank season from the live event.

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
| `setActiveSeason(event, seasonId)` | Activate one configured season and deactivate all others; throws 404 if it does not exist and 409 if a blank-start season's required settings or rubric are missing. Settings-copy seasons inherit the active rubric when their pointer is empty |
| `getSeasonActivationBlockers(season)` | Return missing theme, event dates, voting dates, and rubric requirements |
| `pickSeasonConfig(source)` | Select live event settings copied when an administrator creates a settings-copy season |
| `isUnconfiguredSeason(season)` | Detect a season that was never configured |
| `updateSeasonTweaks(event, seasonId, data)` | Update stored tweaks and synchronize the live settings for the active season. |
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
