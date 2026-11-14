---
title: API Reference
description: Complete reference for all API endpoints in the basishacks backend
---

# API Reference

All API routes live in `server/api/` and use Nitro's file-based routing.

JSON success responses use `{ status, code, data }`; JSON failures use `{ status, code, error, error_description }`. Both shapes come from `@basis/schema`, and the HTTP status always matches the envelope `status`. When a failed request accepts `text/html`, the global error handler instead returns the shared Barry HTML page showing only the canonical error code in parentheses and the same HTTP status. Arrays are returned inside `data`. Redirects, image/file streams, database downloads, and webhook validation challenges remain native responses.

### Security measures applied to all endpoints

Every API endpoint in the system enforces the following security measures:

| Measure | Implementation |
| --- | --- |
| **Rate limiting** | All endpoints are wrapped with `applyRateLimit()` using one of four tier configs (`DEFAULT`, `AUTH`, `VOTE`, `UPLOAD`). Returns 429 with `Retry-After` header when exceeded. |
| **Input validation** | `readValidatedBody(event, Schema.parse)` or `getValidatedQuery(event, Schema.parse)` with bounded Zod schemas. Streaming and webhook bodies retain their byte limits before schema validation. |
| **Length-bounded inputs** | All string fields in Zod schemas have explicit `min()`/`max()` bounds to prevent resource exhaustion. Example: `name: z.string().min(1).max(50)`. |
| **Authentication** | Protected APIs validate a basis-auth token from the encrypted HTTP-only cookie or an explicit bearer header. The separate browser session cookie alone is not authorization. |
| **OAuth2 JWT** | RS256 tokens require the exact issuer and `devconnect://nethack.bisz.dev` audience. Scope hierarchy comes from `@basis/schema`. |
| **HTTP headers** | Security headers (CSP, HSTS, X-Frame-Options, etc.) applied by `security-headers.ts` middleware on every response. |

<AnimatedCounter :target="54" suffix="endpoints" />

---

## Auth

### GET `/api/login`

Starts basis-auth discovery and authorization code with S256 PKCE, state, nonce, and the configured resource.

| Field        | Details                                                          |
| ------------ | ---------------------------------------------------------------- |
| **Auth**     | None                                                             |
| **Query**    | `redirect` (optional safe relative post-login path)              |
| **Response** | 302 redirect to the discovered basis-auth authorization endpoint |
| **Session**  | Separate encrypted HTTP-only transaction, maximum age 10 minutes |

### GET `/api/auth/basis/callback`

Validates the stored transaction and provider response, exchanges the code using `client_secret_basic`, validates the ID token, loads UserInfo, links the verified identity, and seals the access and refresh tokens into an encrypted HTTP-only cookie.

| Field | Details |
| --- | --- |
| **Auth** | None |
| **Query** | OIDC callback parameters (`code`, `state`, or provider error) |
| **Response** | 302 to the stored safe redirect or `/dashboard` |
| **Errors** | 401 for missing/expired transaction, state/nonce/PKCE failure, token/UserInfo failure, or identity conflict |

### GET `/api/auth/session`

Validates the cookie-held access token and returns `{ user: { id }, expiresAt, permissions }`. Access and refresh tokens are never returned to browser JavaScript. Near expiry, the server rotates tokens and reseals the cookie.

### POST `/api/auth/logout`

Attempts to revoke the stored refresh-token family, always clears the local session, and returns the canonical success envelope.

::: info Retired endpoints The native `/.well-known/openid-configuration`, `/api/oauth2/*`, and `/api/applications/*` surfaces have been removed. Register and manage clients in basis-auth. :::

---

## Users

### GET `/api/users`

List all users (mod portal).

| Field        | Details                                           |
| ------------ | ------------------------------------------------- |
| **Auth**     | User with `portal.users.view` permission or admin |
| **Response** | `data: APIUser[]`                                 |

### DELETE `/api/users`

Delete users by ID.

| Field | Details |
| --- | --- |
| **Auth** | User with `dev_users` permission or admin |
| **Body** | `{ ids: number[] }` |
| **Response** | `{ message: string }` |
| **Side effects** | Removes related team_scores, ballot_scores, ballots, peer_voting_scores, user_past_teams, and OAuth2 applications owned by the users |

### GET `/api/users/:id`

Get a single user's profile.

| Field | Details |
| --- | --- |
| **Auth** | Anonymous for the public profile; a valid bearer token reveals the caller's own extended profile |
| **Response** | Self: `GetUserResponse` — own email and full profile with team and past teams; Others: `APIUser` — public profile without email, team ID, or team history. In the self response, current and past team scores require published results, at least three judge evaluations, and that season's `show_scores`; ranks require published results, at least three evaluations, and `show_ranking`. A self-request with `nethack.Judging.resultsRead` or `nethack.all` can see them without those public gates |

### PATCH `/api/users/:id`

Update user profile (name, avatar, profile theme image).

| Field | Details |
| --- | --- |
| **Auth** | The user themselves |
| **Validation** | `UpdateUserRequest` — `{ name?, avatar?, profile_theme_image? }` |
| **Response** | `{ message: string }` |
| **File handling** | Avatar and theme images are validated as base64 data URLs, limited to 7 MiB decoded, and stored as persistent assets |

### GET `/api/users/:id/profile_picture`

Get a user's profile picture.

| Field        | Details                                                           |
| ------------ | ----------------------------------------------------------------- |
| **Auth**     | None                                                              |
| **Response** | Image file (served from `/userast/` directory)                    |
| **Fallback** | Generates a 200px jdenticon identicon if no custom picture exists |

---

## Teams

### GET `/api/teams`

List all teams for the active season, or filter by season.

| Field | Details |
| --- | --- |
| **Auth** | Public for the normal listing; `judging=1` requires `nethack.Judging.assignmentsRead` |
| **Query** | `judging` (if `1`, returns only submitted unjudged teams for the current judge); `season_id` (optional season filter) |
| **Response** | `APITeam[]`; in the public listing, each team's `rank` is only included after that team's season publishes results, at least three judges have evaluated the team, and its `show_ranking` setting is enabled |

### POST `/api/teams`

Create a new team.

| Field          | Details                                                       |
| -------------- | ------------------------------------------------------------- |
| **Auth**       | Current/past team member or all-permissions grant             |
| **Validation** | `CreateTeamRequest` — `{ name: string }`                      |
| **Query**      | `add` (if `true`, automatically adds the creator to the team) |
| **Constraint** | Hackathon status must be `not_started` or `in_progress`       |
| **Response**   | `APITeam`                                                     |

### GET `/api/teams/:id`

Get a single team's details.

| Field | Details |
| --- | --- |
| **Auth** | Public; optional authentication enables the caller's team membership to control score visibility |
| **Response** | `APITeam`; a team member sees `score` only after results are published, at least three judges have evaluated the team, and its season's `show_scores` setting is enabled. Rank requires publication, at least three evaluations, and `show_ranking`. Users with `nethack.Judging.resultsRead` or `nethack.all` bypass these public visibility gates |

### PATCH `/api/teams/:id`

Update team details (save draft).

| Field | Details |
| --- | --- |
| **Auth** | Team member |
| **Validation** | `UpdateTeamRequest` — `{ name?, pathway?, project: { name?, description?, demo_url?, repo_url?, sourcing? } }` |
| **Constraint** | Hackathon status must be `not_started` or `in_progress`; project must not already be submitted |
| **Response** | `{ message: string }` |

### POST `/api/teams/:id/submit`

Final project submission (irreversible).

| Field | Details |
| --- | --- |
| **Auth** | Team member |
| **Validation** | `SubmitTeamRequest` — `{ pathway, project: { name, description, demo_url, repo_url, sourcing? } }` |
| **Constraint** | Hackathon status must be `not_started` or `in_progress`; project must not already be submitted |
| **Response** | `{ message: string }` |
| **Side effects** | Sets `project_submitted = 1` on the team |

### POST `/api/teams/:id/scores`

Finalize a judge's evaluation for an assigned project. New drafts and evaluations must match the active season rubric version and the project's track. A draft created before an organizer publishes a replacement rubric may remain pinned to its older immutable version; finalizing that draft retains the version it was scored against.

| Field | Details |
| --- | --- |
| **Auth** | Judge with an assignment permission |
| **Validation** | `SubmitTeamScoresRequest` — `{ scores: Record<string, integer>, reasoning: string, rubric_version_id: number }` |
| **Constraint** | Judging must be open; one score per judge per team; every criterion must be an integer in its configured range |
| **Privacy check** | Rejects a comment containing the judge's exact email address or display name with `400 Bad Request`; this does not detect indirect identity clues |
| **Response** | `{ message: string }` |

The active judging rubric and saved-draft rubric responses include the selected rubric version's `commentGuidance` object (`introduction`, `guidelines`, and `templates`). Older versions without this field use the built-in defaults. Organizers edit guidance by creating a new immutable rubric version.

### GET `/api/teams/:id/scores`

Read feedback for a team you belong to now or belonged to previously. The response follows `TeamScoreFeedbackResponse`. The route returns 403 until the team's season publishes results. Comments are withheld until at least three judges have evaluated the team; while withheld, `feedback_withheld_for_anonymity` is `true` so the UI can explain the gate without returning the exact review count. When comments are shown, the response contains comment text only and omits judge names and IDs, rubric and track metadata, individual score breakdowns, and stable evaluation ordering. The overall score additionally requires the season's `show_scores` setting, and rank requires `show_ranking`; both remain hidden until at least three judges have evaluated the team.

### GET `/api/admin/teams/:id/scores`

Read the team's full judge feedback with the all-permissions grant. This admin view is available before and after results publication and includes judge names and account IDs in its `TeamScoreFeedbackResponse` entries.

### GET `/api/teams/:id/users`

List current and past members of a team. The complete roster, including email addresses, is available only to a current or past team member or an administrator with the all-permissions grant.

| Field        | Details                                                     |
| ------------ | ----------------------------------------------------------- |
| **Auth**     | Current/past team member or all-permissions grant           |
| **Response** | `GetTeamMembersResponse` — `{ id, email, name, team_id }[]` |

### POST `/api/teams/:id/users`

Add a member to a team by email.

| Field | Details |
| --- | --- |
| **Auth** | Team member |
| **Validation** | `AddTeamMemberRequest` — `{ email: string }` (must be a `@basischina.com` address) |
| **Constraint** | Hackathon status must be `not_started` or `in_progress`; project must not already be submitted |
| **Response** | `{ message: string }` |

### DELETE `/api/teams/:id/users/:user`

Remove a member from a team.

| Field | Details |
| --- | --- |
| **Auth** | Team member (can remove self or others) |
| **Constraint** | Hackathon status must be `not_started` or `in_progress`; project must not already be submitted |
| **Response** | `{ message: string }` |
| **Side effects** | Records the team in `user_past_teams` before removing |

---

## Ballot

### GET `/api/ballot`

Get the current user's ballot for peer voting.

| Field           | Details                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| **Auth**        | Current/past team member or all-permissions grant                          |
| **Constraint**  | Hackathon status must be `voting`                                          |
| **Response**    | `GetBallotResponse` — `{ submitted, projects, scores, reasoning }`         |
| **Eligibility** | Projects are filtered to the same pathway and exclude the voter's own team |

### POST `/api/ballot`

Submit peer voting ballot.

| Field | Details |
| --- | --- |
| **Auth** | Current/past team member or all-permissions grant |
| **Validation** | `SubmitVoteRequest` — `{ scores: number[] (0-5 each, sum = 10), reasoning: string }` |
| **Constraint** | Hackathon status must be `voting`; number of scores must match eligible projects |
| **Response** | `{ message: string }` |
| **Side effects** | Upserts a row in `peer_voting_scores` |

### GET `/api/ballot/summary`

Developer endpoint returning per-season judging progress (project, submitted, and scored counts).

| Field        | Details                                                             |
| ------------ | ------------------------------------------------------------------- |
| **Auth**     | Current/past team member or all-permissions grant                   |
| **Response** | `{ current: BallotSummaryItem \| null, past: BallotSummaryItem[] }` |

---

## Seasons

### GET `/api/seasons`

List public season details. Theme fields are null while a season has not started or is paused. Rubric identifiers, score-curve configuration, and other organizer-only fields are not included.

| Field        | Details           |
| ------------ | ----------------- |
| **Auth**     | Public, read-only |
| **Response** | `PublicSeason[]`  |

### GET `/api/seasons/active`

Get the currently active season (public).

| Field | Details |
| --- | --- |
| **Auth** | None |
| **Response** | Combined season and hackathon state (including `show_scores` / `show_ranking` toggles); theme is hidden when hackathon status is `not_started` or `paused` |

### PATCH `/api/seasons/active`

Set the active season. The newly active season's tweaks are copied into the live `hackathon` row.

| Field          | Details                                                    |
| -------------- | ---------------------------------------------------------- |
| **Auth**       | User with `portal.seasons.edit` permission or admin        |
| **Validation** | `SetActiveSeasonRequest` — `{ season_id: number \| null }` |
| **Response**   | `{ message: string }`                                      |

### GET `/api/seasons/:id/tweaks`

Get the public details of a single season.

The `id` path value must be a positive safe integer. Missing, malformed, zero, negative, or unsafe values return `400`; a well-formed ID with no matching season returns `404`.

| Field        | Details           |
| ------------ | ----------------- |
| **Auth**     | Public, read-only |
| **Response** | `PublicSeason`    |

This response is an allowlisted public DTO. Rubric identifiers, score-curve configuration, judging controls, and other organizer-only fields are omitted. Theme fields are `null` until the season begins and while it is paused.

### PATCH `/api/seasons/:id/tweaks`

Update the tweakable settings of a single season. Accepts a partial body with any of: `status`, `show_scores`, `show_ranking` (booleans). Only these three settings are tweakable; any other fields in the request body are stripped.

The `id` path value must be a positive safe integer. Missing, malformed, zero, negative, or unsafe values return `400`; a well-formed ID with no matching season returns `404`.

When the season is the currently active (live) season, the `hackathon` singleton row is updated as well so changes take effect immediately.

| Field          | Details                                             |
| -------------- | --------------------------------------------------- |
| **Auth**       | User with `portal.seasons.edit` permission or admin |
| **Validation** | `UpdateSeasonTweaksRequest` (at least one field)    |
| **Response**   | `{ message: string }`                               |
| **Rate limit** | Yes                                                 |

---

## Admin

### GET `/api/admin/teams`

List all teams across all seasons (mod portal).

| Field | Details |
| --- | --- |
| **Auth** | User with `dev_teams` permission or admin |
| **Response** | Array of team objects with `season_name` and `members` (array of `{ id, name, email, profile_picture }`) |

### DELETE `/api/admin/teams`

Delete teams by ID.

| Field | Details |
| --- | --- |
| **Auth** | Admin |
| **Body** | `{ ids: number[] }` |
| **Response** | `{ message: string }` |
| **Side effects** | Removes ballot_scores, team_scores, team_awards, user_past_teams, and unassigns users |

### GET `/api/admin/scores`

List computed judge scores and ranks for submitted teams in the selected season. Pass `?season_id={id}` to select a season; otherwise the active season is used. This reads calculated results without persisting them.

| Field        | Details                                    |
| ------------ | ------------------------------------------ |
| **Auth**     | All-permissions grant                      |
| **Query**    | Optional `season_id`                       |
| **Response** | `APITeam[]` with scores and ranks included |

### POST `/api/admin/scores/compute`

Recompute and persist judge averages and ranks for a season. Pass `?season_id={id}` to select a season; otherwise the active season is used. This operation requires the judging results-compute permission.

| Field        | Details                                  |
| ------------ | ---------------------------------------- |
| **Auth**     | Judging results-compute permission       |
| **Query**    | Optional `season_id`                     |
| **Response** | `{ message: string, season_id: number }` |

### Rubric administration

Season update permission is required for these endpoints. Rubric definitions support named tracks, integer score ranges, and criteria weights totaling 100 per track.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/seasons/:id/rubric` | Get the active rubric version, season history, and reusable templates |
| POST | `/api/admin/seasons/:id/rubric` | Create and activate a version from a definition, prior season, or template |
| PATCH | `/api/admin/seasons/:id/score-curve` | Set the season's presentation-only score curve preset |
| GET/POST | `/api/admin/rubric-templates` | List reusable templates or create one |
| PUT/DELETE | `/api/admin/rubric-templates/:id` | Update or delete a reusable template |

### GET `/api/admin/hackathon`

Read the current global hackathon configuration and all seasons.

| Field        | Details                                       |
| ------------ | --------------------------------------------- |
| **Auth**     | Admin                                         |
| **Response** | `{ hackathon: Hackathon, seasons: Season[] }` |

### PATCH `/api/admin/hackathon`

Update hackathon configuration. All fields are per-season when `season_id` is provided. When `season_id` matches the currently active season, changes are also synced to the global hackathon row so the rest of the app sees the active season's config.

| Field        | Details                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Auth**     | Admin                                                                      |
| **Body**     | Partial `AdminUpdateHackathonRequest` (all fields optional) + `season_id?` |
| **Response** | `{ hackathon: Hackathon, seasons: Season[] }`                              |

### POST `/api/admin/seasons`

Create a new season.

| Field        | Details                                |
| ------------ | -------------------------------------- |
| **Auth**     | Admin                                  |
| **Body**     | `{ name: string, is_active?: 0 \| 1 }` |
| **Response** | `{ seasons: Season[] }`                |

### PATCH `/api/admin/seasons`

Rename, activate, or deactivate a season.

| Field        | Details                                             |
| ------------ | --------------------------------------------------- |
| **Auth**     | Admin                                               |
| **Body**     | `{ id: number, name?: string, is_active?: 0 \| 1 }` |
| **Response** | `{ seasons: Season[] }`                             |

### DELETE `/api/admin/seasons/[id]`

Delete an empty, inactive season by ID. Active seasons and seasons with teams or judging history return `409 Conflict`; deleting an eligible season also removes its unused rubric versions.

| Field        | Details                 |
| ------------ | ----------------------- |
| **Auth**     | Admin                   |
| **Params**   | `id` — positive integer |
| **Response** | `{ seasons: Season[] }` |

### GET `/api/admin/database/export`

Download an anonymized JSON snapshot or CSV export of the database.

| Field | Details |
| --- | --- |
| **Auth** | Admin |
| **Query** | `format` — `json` (default) or `csv` |
| **Response** | JSON snapshot or `text/csv` with per-table sections; judge identities and draft evaluations are excluded, and formula-like CSV values are neutralized |

---

## Debug

### POST `/api/debug/upload`

The debug upload endpoint has been retired. It returns `410 Gone` for requests that pass the global middleware where debug routes are enabled. Existing download URLs continue to work.

### GET `/api/debug/files`

List existing files in the debug asset collections.

| Field | Details |
| --- | --- |
| **Auth** | Authenticated user with `nethack.Debug.filesRead` permission or `nethack.all` |
| **Response** | `{ assets: string[], userast: string[] }` — filenames from `assets/uploads` and top-level `userassets` |

### GET `/api/assets/references`

List active permalink references owned by the authenticated user. A user with `nethack.all` sees all references.

| Field | Details |
| --- | --- |
| **Auth** | Authenticated user; admins with `nethack.all` can view all owners' references |
| **Query** | `page` (default `1`, maximum `100000`); `page_size` (default `20`, range `1–50`) |
| **Response** | `{ items, page, page_size, total, total_pages }`; each item contains `id`, `collection`, `asset_path`, `created_at`, and `permalink` |

### DELETE `/api/assets/references/:referenceId`

Release one permalink reference by UUID. Only its owner or a user with `nethack.all` can release it. Missing and non-owned references both return `404`. Releasing a reference removes the record. The file remains accessible at its existing URL.

### DeepSeek Sessions

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/debug/deepseek/sessions` | `nethack.Debug.deepseekWrite` or `nethack.all` | Create a new chat session `{ sessionName }` |
| GET | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekRead` or `nethack.all` | Get session with messages |
| DELETE | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekWrite` or `nethack.all` | Delete a session |
| POST | `/api/debug/deepseek/sessions/:id/message` | `nethack.Debug.deepseekWrite` or `nethack.all` | Send a message `{ message, role?, toolCallId?, toolResult? }` |

---

---

## Webhooks

### POST `/api/_webhooks/update`

Microsoft Graph webhook notification endpoint.

| Field        | Details                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Auth**     | Validated via `clientState` (webhook state) and optional `validationToken` |
| **Body**     | Microsoft Graph change notification payload                                |
| **Response** | 200 OK (echoes `validationToken` as `text/plain` when present)             |

The optional validation token and each bounded notification field are validated with Zod after the request body limit is enforced.

### POST `/api/_webhooks/lifecycle`

Microsoft Graph lifecycle notification endpoint (reauthorization, etc.).

| Field | Details |
| --- | --- |
| **Auth** | Microsoft Graph (validated via `clientState` and `validationToken`) |
| **Body** | Lifecycle notification payload |
| **Response** | 202 Accepted; refreshes the subscription when `lifecycleEvent` is `reauthorizationRequired` |

The optional validation token and each bounded notification field are validated with Zod after the request body limit is enforced.

---

<TerminalWindow title="basishacks@api-test:~" prompt="$">

```bash
# Quick health check
curl -s https://localhost:24598/api/health | jq .

# List teams (authenticated)
curl -s -H "Cookie: session=..." \
  https://localhost:24598/api/teams
```

</TerminalWindow>
