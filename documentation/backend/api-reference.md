---
title: API Reference
description: Complete reference for all API endpoints in the nethack backend
---

# API Reference

All API routes live in `server/api/` and use Nitro's file-based routing.

JSON success responses use `{ status, code, data }`; JSON failures use `{ status, code, error, error_description }`. Both shapes come from `@basis/schema`, and the HTTP status always matches the envelope `status`. When a failed request accepts `text/html`, the global error handler instead returns the shared Barry HTML page showing only the canonical error code in parentheses and the same HTTP status. Arrays are returned inside `data`. Redirects, image/file streams, database downloads, and webhook validation challenges remain native responses.

### Security measures applied to all endpoints

Every API endpoint in the system enforces the following security measures:

| Measure | Implementation |
| --- | --- |
| **Rate limiting** | All endpoints are wrapped with `applyRateLimit()` using tier configs (`DEFAULT`, `JUDGING_DRAFT`, `AUTH`, `VOTE`, `UPLOAD`, `BACKCHANNEL`). A process-wide pre-body IP gate also runs on `/api/*`. Returns 429 with `Retry-After` when exceeded. |
| **Input validation** | `readValidatedBody(event, Schema.parse)` or `getValidatedQuery(event, Schema.parse)` with bounded Zod schemas. Streaming and webhook bodies retain their byte limits before schema validation. |
| **Length-bounded inputs** | All string fields in Zod schemas have explicit `min()`/`max()` bounds to prevent resource exhaustion. Example: `name: z.string().min(1).max(50)`. |
| **Authentication** | Protected APIs validate a basis-auth token from the encrypted HTTP-only cookie or an explicit bearer header. The separate browser session cookie alone is not authorization. |
| **basis-auth JWT** | RS256 tokens require the exact issuer and the `BASIS_AUTH_RESOURCE` audience. Permission hierarchy comes from `@basis/schema`. |
| **HTTP headers** | Security headers (CSP, HSTS, X-Frame-Options, etc.) applied by `security-headers.ts` middleware on every response. |

<AnimatedCounter :target="96" suffix="route handlers" />

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
| **Errors** | 401 for missing/expired transaction, state/nonce/PKCE failure, token/UserInfo failure, identity conflict, or a resolved account that differs from the one signed in when the flow began |

### GET `/api/auth/session`

Validates the cookie-held access token and returns `{ user: { id }, expiresAt, permissions }`. Access and refresh tokens are never returned to browser JavaScript. Near expiry, the server rotates tokens and reseals the cookie.

### POST `/api/auth/logout`

Attempts to revoke the stored refresh-token family, always clears the local session, and returns the canonical success envelope.

### POST `/api/auth/basis/backchannel`

The resource's backchannel logout receiver. basis-auth posts form-encoded events and verifies the URL before saving it.

| Field | Details |
| --- | --- |
| **Auth** | basis-auth only; requests are rate limited per peer |
| **Body** | `action=test&nonce&challenge`, `logout_token`, or `action=revoke_access_token&jti&valid_after&revocation_token` |
| **Success** | `202` for a webhook challenge, `204` after a logout token or revocation is persisted |
| **Errors** | `400` for a malformed challenge, an unverifiable event token, or a revocation token that does not match the form fields |

A `logout_token` sets `users.tokens_valid_after` for its subject, which invalidates every local session that predates the logout. A revocation adds the signed `jti` to `revoked_access_tokens` from its signed `valid_after` time. The webhook proof is signed with `BASIS_AUTH_RESOURCE_SECRET` and posted to `/internal/backchannel/validate` after the `202` response.

::: info Retired endpoints The native `/.well-known/openid-configuration`, `/api/oauth2/*`, and `/api/applications/*` surfaces have been removed. Register and manage clients in basis-auth. :::

---

## Users

### GET `/api/users`

List all users (mod portal).

| Field | Details |
| --- | --- |
| **Auth** | `nethack.Users.list` |
| **Response** | `data: (APIUser & { is_admin: boolean; is_initial_admin: boolean })[]`; `is_initial_admin` marks an address currently in `INITIAL_ADMIN_EMAILS` without shipping the email allowlist to the browser |

### DELETE `/api/users`

Delete users by ID.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.Users.delete` |
| **Body** | `{ ids: number[] }` (at most `MAX_BULK_DELETE_IDS` = 100) |
| **Response** | `{ message: string }` |
| **Side effects** | Removes related team_scores, ballot_scores, ballots, peer_voting_scores, user_past_teams, and notifications; legacy OAuth2 applications are detached from the deleted owner rather than removed. Removed evaluations trigger a standings recompute |
| **Protection** | Rejects self-deletion and any deletion that would leave no administrator (`403`); a team left without members returns `409` |

### GET `/api/users/:id`

Get a single user's profile.

| Field | Details |
| --- | --- |
| **Auth** | Anonymous for the public profile; a valid bearer token reveals the caller's own extended profile |
| **Response** | Self: `GetUserResponse` — own email and full profile with team and past teams; Others: `APIUser` — public profile without email, team ID, or team history. `team` is the active-season membership only; a pointer left over from an earlier season is returned in `past_teams` instead. In the self response, current and past team scores require published results, at least three judge evaluations, and that season's `show_scores`; ranks require published results, at least three evaluations, and `show_ranking`; awards require that team's season to publish results. A self-request with `nethack.Judging.resultsRead` or `nethack.all` can see them without those public gates |

### PATCH `/api/users/:id`

Update the user’s display name or profile theme image. Avatars synchronize from basis-auth on login. The avatar route serves a fresh local cache before contacting the provider and refreshes at most once per five minutes, so unauthenticated page traffic cannot amplify identity-provider requests.

| Field | Details |
| --- | --- |
| **Auth** | The user themselves |
| **Validation** | `UpdateUserRequest` — `{ name?, profile_theme_image? }` |
| **Response** | `{ message: string }` |
| **File handling** | Theme images are validated as base64 data URLs, limited to 7 MiB decoded, and stored as persistent assets |

### PATCH `/api/users/:id/admin`

Promote or demote a user.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.all` |
| **Body** | `{ is_admin: boolean }` |
| **Protections** | Self-demotion is rejected; the last remaining administrator cannot be demoted. Initial-admin elevation is reapplied at sign-in while the address stays in `INITIAL_ADMIN_EMAILS`, so remove it there before demoting |
| **Response** | `{ id: number, is_admin: boolean }` |

### GET `/api/users/:id/profile_picture`

Get a user's profile picture.

| Field        | Details                                                             |
| ------------ | ------------------------------------------------------------------- |
| **Auth**     | None                                                                |
| **Response** | Image from the configured basis-auth issuer or a legacy local asset |
| **Fallback** | Generates a 200px jdenticon identicon if no picture is available    |

---

## Teams

### GET `/api/teams`

List submitted teams for the active season, or filter by season.

| Field | Details |
| --- | --- |
| **Auth** | Public for the normal listing; `judging=true` requires `nethack.Judging.assignmentsRead` |
| **Query** | `judging` (if `true`, returns submitted teams in the current judge's assignment and recusal scope, excluding the judge's own team); `season_id` (optional season filter; when omitted, only the active season is listed); `limit` (1–50) and `after` (team ID cursor) |
| **Privacy** | Before the event enters peer voting, the active-season listing returns only the caller's own team, even if the submission deadline has passed while the season is still in progress. Past-season listings are not gated by the active event. |
| **Response** | `APITeam[]`; only teams with `project_submitted = 1` and `status = 'active'` are public, ordered by team ID. With `limit`, returns `{ items, next_cursor }`; `next_cursor` is the last team ID or `null`. In the public listing, each team's `rank` is only included after that team's season publishes results, at least three judges have evaluated the team, and its `show_ranking` setting is enabled. Awards follow the same publication gate |

### POST `/api/teams`

Create a new team.

| Field | Details |
| --- | --- |
| **Auth** | Current/past team member or all-permissions grant |
| **Validation** | `CreateTeamRequest` — `{ name: string }` |
| **Constraint** | Submissions must be open: status `not_started` or `in_progress`, event not `paused`, and the submission deadline plus `SUBMISSION_GRACE_MS` not passed. The creator becomes the owner inside the same transaction, so a team never exists without a member; a creator already in an active-season team gets `403`; team names are unique per season (case-insensitive, `409` on conflict) |
| **Response** | `APITeam` |

### GET `/api/teams/:id`

Get a single team's details.

| Field | Details |
| --- | --- |
| **Auth** | Public; optional authentication enables the caller's team membership to control score visibility |
| **Privacy** | An active-season team is visible only to its current members, judging staff, and administrators until the event enters peer voting; everyone else receives 404. An unsubmitted team is visible only to its members and users with `nethack.Judging.resultsRead` or `nethack.all`. Past-season teams remain readable |
| **Response** | `APITeam`; a team member sees `score` only after results are published, at least three judges have evaluated the team, and its season's `show_scores` setting is enabled. Rank requires publication, at least three evaluations, and `show_ranking`. Users with `nethack.Judging.resultsRead` or `nethack.all` bypass these public visibility gates |

### PATCH `/api/teams/:id`

Update team details (save draft).

| Field | Details |
| --- | --- |
| **Auth** | Team member |
| **Validation** | `UpdateTeamRequest` — `{ name?, pathway?, project: { name?, description?, demo_url?, repo_url?, video_url?, sourcing? } }` |
| **Constraint** | Submissions must be open; the team must belong to the active season; project must not already be submitted (`409`); only the owner may rename; a rename must not duplicate another team's name in the season (`409`); `pathway` must exist in the season rubric |
| **Response** | `{ message: string }` |
| **Side effects** | Writes only the supplied columns, preserving a teammate's concurrent edit of a different field |

### POST `/api/teams/:id/submit`

Final project submission (irreversible).

| Field | Details |
| --- | --- |
| **Auth** | Team member |
| **Validation** | `SubmitTeamRequest` — `{ pathway, project: { name, description, demo_url, repo_url, video_url, sourcing } }`. Demo, repository, demonstration-video, and AI-use disclosure fields are required |
| **Constraint** | Submissions must be open; project must not already be submitted (`409`); `pathway` must exist in the season rubric |
| **Response** | `{ message: string }` |
| **Side effects** | Sets `project_submitted = 1` and `submitted_at` on the team. Submission is irreversible from the participant side; an administrator may reopen it before results are published after deleting its evaluations |

### POST `/api/teams/:id/scores`

Finalize a judge's evaluation for an assigned project. New drafts and evaluations must match the active season rubric version and the project's track. A draft created before an organizer publishes a replacement rubric may remain pinned to its older immutable version; finalizing that draft retains the version it was scored against.

| Field | Details |
| --- | --- |
| **Auth** | Judge with an assignment permission |
| **Validation** | `SubmitTeamScoresRequest` — `{ scores: Record<string, integer>, reasoning: string, rubric_version_id: number }` |
| **Constraint** | Judging must be open (not paused, `judging_open`, and not frozen by publication unless `JUDGING_AFTER_PUBLISH` is on); the team must be in the judge's assignment scope and not recused; one score per judge per team; every criterion must be an integer in its configured range |
| **Privacy check** | Rejects a comment containing the judge's exact email address or display name with `400 Bad Request`; this does not detect indirect identity clues |
| **Response** | `{ message: string }` |

The active judging rubric and saved-draft rubric responses include the selected rubric version's `commentGuidance` object (`introduction`, `guidelines`, and `templates`). Older versions without this field use the built-in defaults. Organizers edit guidance by creating a new immutable rubric version.

### POST `/api/judging/recusals`

Record a conflict-of-interest recusal for the active season. The team is removed from the judge's queue and submissions for it are refused.

| Field        | Details                                                              |
| ------------ | -------------------------------------------------------------------- |
| **Auth**     | `nethack.Judging.scoresWriteAssigned`                                |
| **Body**     | `{ team_id: number, season_id?: number, reason?: string (max 500) }` |
| **Response** | `{ message: string }`                                                |
| **Audit**    | `judging.recusal`                                                    |

### POST `/api/judging/flag`

Report a conflict or concern about a project to the organizers. The judge cannot flag their own team.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.Judging.assignmentsRead` |
| **Body** | `{ team_id: number, reason: string (5–1000 characters) }` |
| **Response** | `{ message: string }` |
| **Side effects** | Upserts one flag per season, judge, and team; re-flagging reopens it. All administrators receive a `judge_flag` notification, and a `judging.flag` audit row is written |

### GET `/api/judging/rubric`

Active rubric for the judging workspace.

| Field        | Details                                         |
| ------------ | ----------------------------------------------- |
| **Auth**     | `nethack.Judging.assignmentsRead`               |
| **Response** | `{ version_id, name, tracks, commentGuidance }` |
| **Errors**   | `409` when the active season has no rubric      |

### GET `/api/judging/history/:seasonId`

Read the signed-in judge's finalized evaluations for one season, including past seasons and the active season after judging closes. Only the requesting judge's evaluations are returned.

| Field | Details |
| --- | --- |
| **Auth** | Judge with `nethack.Judging.assignmentsRead` |
| **Params** | `seasonId` — positive integer |
| **Query** | Optional `limit` (1–50) and `after` (team ID cursor); with `limit`, the response also includes `next_cursor` |
| **Response** | `GetJudgingHistoryResponse` — `{ season, items, unavailable_evaluations }` |
| **Items** | `team` (`APITeam` with description and AI-use disclosure), rubric name and version, track name, normalized weighted score, criterion scores, anonymous feedback, and an optional `unavailable` flag |
| **Edge cases** | Returns `404` for an unknown season and an empty list when the judge has no evaluations. An evaluation whose saved rubric or score payload cannot be read is still returned with `unavailable: true`, `normalized_score: null`, the project details, and the written feedback; it is also counted in `unavailable_evaluations` |

### GET `/api/teams/:id/scores`

Read feedback for a team you belong to now or belonged to previously. The response follows `TeamScoreFeedbackResponse`. The route returns 403 until the team's season publishes results. Comments are withheld until at least three judges have evaluated the team; while withheld, `feedback_withheld_for_anonymity` is `true` so the UI can explain the gate without returning the exact review count. Evaluations whose saved rubric or score payload cannot be read are skipped, and `unavailable_evaluations` reports how many were omitted so the remaining feedback and score stay usable. When comments are shown, the response contains comment text only and omits judge names and IDs, rubric and track metadata, individual score breakdowns, and stable evaluation ordering. The overall score additionally requires the season's `show_scores` setting, and rank requires `show_ranking`; both remain hidden until at least three judges have evaluated the team.

### GET `/api/admin/teams/:id/scores`

Read the team's full judge feedback with the all-permissions grant. This admin view is available before and after results publication and includes judge names and account IDs in its `TeamScoreFeedbackResponse` entries.

### GET `/api/teams/:id/users`

List current and past members of a team. The complete roster, including email addresses, is available only to the team's current members or an administrator with the all-permissions grant; a former member no longer receives the roster.

| Field        | Details                                                     |
| ------------ | ----------------------------------------------------------- |
| **Auth**     | Current team member or all-permissions grant                |
| **Response** | `GetTeamMembersResponse` — `{ id, email, name, team_id }[]` |

### POST `/api/teams/:id/users`

Invite a person to a team by email. The invitation is stored in `team_invites`; the recipient must accept it from their dashboard before joining. Sending an invitation never changes the recipient's membership.

| Field | Details |
| --- | --- |
| **Auth** | Team owner |
| **Validation** | `AddTeamMemberRequest` — `{ email: string, allowUnclaimed?: boolean }` (must be a `@basischina.com` address) |
| **Constraint** | Submissions must be open; project must not already be submitted; the team must have fewer than the season's `max_team_members` members plus pending invitations; the target cannot be yourself, a staff administrator, or someone already in an active-season team. A missing account requires `allowUnclaimed: true` |
| **Response** | `{ id, email, token, expires_at, invite_url, message }` — the raw token and link are returned once. Only its SHA-256 digest is stored |
| **Lifetime** | `TEAM_INVITE_TTL_DAYS` days (default 7, maximum 365) |

### GET `/api/teams/:id/invites`

List pending invitations for a team. Email addresses are visible only to current members.

| Field | Details |
| --- | --- |
| **Auth** | Current team member |
| **Response** | `GetTeamInvitesResponse` — `{ invites: [{ id, email, expires_at }], max_team_members }`; expired invitations are omitted |

### DELETE `/api/teams/:id/invites/:invite`

Cancel a pending invitation. Only current team members may cancel.

| Field        | Details               |
| ------------ | --------------------- |
| **Auth**     | Current team member   |
| **Response** | `{ message: string }` |

### GET `/api/team-invites`

List invitations addressed to the authenticated user's email.

| Field        | Details                                                                |
| ------------ | ---------------------------------------------------------------------- |
| **Auth**     | `nethack.Teams.membersAddOwn` (participant bundle)                     |
| **Response** | `GetUserInvitesResponse` — `{ invites: [{ id, team_id, team_name }] }` |

### POST `/api/team-invites/:id/accept`

Accept an invitation addressed to the authenticated user's email. Submissions must be open; the team must belong to the active season, be `active`, must not have submitted, and must not be full.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.Teams.membersAddOwn` |
| **Response** | `{ message: string }`; the owner receives a `team_invite_accepted` notification |
| **Side effects** | Sets `users.team_id`, removes every invitation for that email, and records no history until the user leaves |

### DELETE `/api/team-invites/:id`

Decline an invitation addressed to the authenticated user's email.

| Field        | Details                       |
| ------------ | ----------------------------- |
| **Auth**     | `nethack.Teams.membersAddOwn` |
| **Response** | `{ message: string }`         |

### DELETE `/api/teams/:id/users/:user`

Remove a member from a team.

| Field | Details |
| --- | --- |
| **Auth** | Team member (can remove self or others); removing another member requires ownership |
| **Constraint** | Submissions must be open; project must not already be submitted; the last member cannot be removed |
| **Response** | `{ message: string }` |
| **Side effects** | Records the team in `user_past_teams` before removing |

### PATCH `/api/teams/:id/owner`

Transfer team ownership to another current member.

| Field | Details |
| --- | --- |
| **Auth** | Current team owner |
| **Validation** | `TransferTeamOwnerRequest` — `{ user_id: number }` |
| **Constraint** | Submissions must be open; project must not already be submitted; the target must be a current member; transferring to the current owner returns `409` |
| **Response** | `{ message: string }` |
| **Side effects** | Writes a `team.transfer_owner` audit event |

### DELETE `/api/teams/:id`

Disband the team and withdraw it from the event.

| Field | Details |
| --- | --- |
| **Auth** | Current team owner |
| **Constraint** | Submissions must be open; project must not already be submitted; a team with judge evaluations cannot be disbanded |
| **Response** | `{ message: string }` |
| **Side effects** | Records every member in `user_past_teams`, detaches members, deletes pending invitations, sets `teams.status = 'withdrawn'`, and writes a `team.disband` audit event |

### POST `/api/team-invites/token/:token/accept`

Accept an invitation using the bearer token from its link.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.Teams.membersAddOwn` |
| **Params** | `token` — 64 lowercase hexadecimal characters |
| **Constraint** | Submissions must be open; the invitation must not be expired; the team must belong to the active season, be `active`, not have submitted, and have room; the caller must not already be in an active-season team |
| **Success** | `{ message: string }`; the owner receives a `team_invite_accepted` notification |
| **Errors** | `404` for an unknown token or an email mismatch, `410` for an expired invitation, `409` for a full, submitted, withdrawn, or ended-season team |

---

## Ballot

### GET `/api/ballot`

Get the current user's ballot for peer voting.

| Field | Details |
| --- | --- |
| **Auth** | Current/past team member or all-permissions grant |
| **Constraint** | `voting_enabled` must be `1`, the event must not be `paused`, and the current time must be inside the configured voting window while `ENFORCE_DEADLINES` is on. A configured `voting_start_timestamp` in the future keeps the ballot closed even when the toggle is on |
| **Response** | `GetBallotResponse` — `{ submitted, projects, scores, reasoning, max_votes_per_user }` |
| **Eligibility** | Projects are filtered to the same pathway and exclude the voter's own team |
| **Season scope** | Ballots are stored per season; a previous season's ballot never appears here |

### POST `/api/ballot`

Submit peer voting ballot.

| Field | Details |
| --- | --- |
| **Auth** | Current/past team member or all-permissions grant |
| **Validation** | `SubmitVoteRequest` — `{ scores: number[] (0-5 each, sum = 10), reasoning: string }`; the number of scores must match eligible projects, and at most `max_votes_per_user` projects may receive a non-zero score (`0` means unlimited) |
| **Constraint** | `voting_enabled` must be `1`, the event must not be `paused`, and the current time must be inside the configured voting window while `ENFORCE_DEADLINES` is on. A configured `voting_start_timestamp` in the future keeps the ballot closed even when the toggle is on |
| **Response** | `{ message: string }` |
| **Side effects** | Upserts the row for `(user_id, season_id)` in `peer_voting_scores`; a participant may update their ballot until voting closes. Each season keeps its own ballot |

### GET `/api/ballot/results`

Peer-vote aggregates for a season. Each voting team contributes one unit: its members' ballots are averaged, then the unit values are averaged across every team that voted. Ballots with no recorded `team_id` provenance are excluded; the aggregation never reattributes a legacy ballot to the voter's current team.

| Field | Details |
| --- | --- |
| **Auth** | Public after the gates; judging staff may read before publication |
| **Query** | Optional `season_id` |
| **Gate** | Voting must be closed. The gallery gate must be open, and results must be published for the active season; otherwise `403` for public callers |
| **Response** | `BallotResultsResponse` — `{ season_id, results_visible, voting_closed, turnout: { submitted_teams, voting_teams, ballots, turnout_ratio }, projects: [{ team_id, name, pathway, average_stars, team_units }] }` |

### GET `/api/ballot/summary`

Developer endpoint returning per-season judging progress (project, submitted, and scored counts). The judge's own team is excluded from all three counts so progress can reach completion. `scored_count` counts only distinct **submitted** teams the current judge has evaluated, so a leftover score on an unsubmitted team cannot make the queue look complete.

| Field        | Details                                                             |
| ------------ | ------------------------------------------------------------------- |
| **Auth**     | Current/past team member or all-permissions grant                   |
| **Response** | `{ current: BallotSummaryItem \| null, past: BallotSummaryItem[] }` |

---

## Notifications

### GET `/api/notifications`

List the caller's notifications, newest first.

| Field | Details |
| --- | --- |
| **Auth** | Any authenticated user |
| **Query** | `limit` (1–100, default 50) |
| **Response** | `GetNotificationsResponse` — `{ notifications: [{ id, type, title, body, link, read_at, created_at }], unread }` |

Notification types currently created by the server: `team_invite`, `team_invite_accepted`, `results_published`, and `judge_flag`.

### PATCH `/api/notifications/:id/read`

Mark one notification read. Only the recipient may update it; a missing or foreign ID returns `404`.

### PATCH `/api/notifications/read-all`

Mark every unread notification for the caller read.

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
| **Response** | Combined season and hackathon state (including `show_scores` / `show_ranking` toggles, `announcement`, `max_team_members`, `is_submission_closed`, and `is_gallery_public`). `is_judging_open` and `is_voting_open` are the server-computed gates the judging and ballot APIs enforce: judging requires `judging_open`, is off while `paused`, and is frozen after publication in a `finished` season unless `JUDGING_AFTER_PUBLISH` is on; voting requires `voting_enabled`, is off while `paused`, and stays inside `voting_start_timestamp`–`voting_end_timestamp` unless `ENFORCE_DEADLINES` is off. Theme is hidden when hackathon status is `not_started` or `paused` |

### PATCH `/api/seasons/active`

Set the active season. The activated season's full settings, including schedule and theme, are stored in PostgreSQL and apply immediately regardless of where the manifest is hosted. The portal does not write `HACKATHON.yml`; it seeds and compares values only. Activation snapshots the outgoing season and writes the activated season's settings to the live singleton.

| Field          | Details                                                    |
| -------------- | ---------------------------------------------------------- |
| **Auth**       | User with `portal.seasons.edit` permission or admin        |
| **Validation** | `SetActiveSeasonRequest` — `{ season_id: number \| null }` |
| **Response**   | `{ message: string }`                                      |

### GET `/api/seasons/active/rubric`

Public view of the active season's rubric tracks and criteria, so participants can choose a track before submitting. Returns `404` without an active season and `409` when the season has no rubric. The judge-only `GET /api/judging/rubric` additionally returns the version name and comment guidance.

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

The active season uses YAML settings and this endpoint returns 409 for live edits in YAML mode.

| Field | Details |
| --- | --- |
| **Auth** | User with `portal.seasons.edit` permission or admin |
| **Validation** | `UpdateSeasonTweaksRequest` (at least one field) |
| **Response** | `{ message: string }` |
| **Audit** | Writes `season.tweaks` with the previous and new tweak values in the same transaction |
| **Rate limit** | Yes |

---

## Admin

### GET `/api/admin/teams`

List all teams across all seasons (mod portal).

| Field | Details |
| --- | --- |
| **Auth** | Administrator (`nethack.all`) |
| **Response** | Array of team objects with `season_name` and `members` (array of `{ id, name, email, profile_picture }`) |

### DELETE `/api/admin/teams`

Delete teams by ID.

| Field | Details |
| --- | --- |
| **Auth** | Admin |
| **Body** | `{ ids: number[] }` (at most `MAX_BULK_DELETE_IDS` = 100) |
| **Response** | `{ message: string }` |
| **Side effects** | Removes ballot_scores, team_scores, team_awards, user_past_teams, and unassigns users |
| **Protection** | Rejected with `403` if it would leave no administrator |

### Team operations

#### PATCH `/api/admin/teams/:id/status`

Set a team's status to `active`, `withdrawn`, `disqualified`, or `no_show`. The update and standings recompute share one transaction; a non-active team receives no public rank.

| Field        | Details                                                    |
| ------------ | ---------------------------------------------------------- |
| **Auth**     | `nethack.all`                                              |
| **Body**     | `{ status, reason?: string (max 500) }`                    |
| **Response** | `{ season_id, standings: AdminStandingRow[] }`             |
| **Audit**    | `team.status` with before/after status and optional reason |

#### POST `/api/admin/teams/:id/reopen`

Reopen a submitted project so the team can edit and submit again.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.all` |
| **Body** | `{ reason?: string (max 500) }` |
| **Constraint** | Returns `409` after results are published or while the team still has evaluations. Delete the evaluations first |
| **Response** | `{ message, team_id }` |
| **Audit** | `team.reopen` with the prior `submitted_at` |

#### DELETE `/api/admin/teams/:id/scores/:judgeId`

Void one judge's committed evaluation and recompute standings.

| Field        | Details                                        |
| ------------ | ---------------------------------------------- |
| **Auth**     | `nethack.all`                                  |
| **Params**   | `id`, `judgeId` — positive integers            |
| **Response** | `{ season_id, standings: AdminStandingRow[] }` |
| **Errors**   | `404` when the evaluation does not exist       |
| **Audit**    | `score.delete` with the deleted score payload  |

#### GET `/api/admin/standings.csv`

Download season standings as CSV.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.all` |
| **Query** | Optional `season_id` |
| **Response** | `text/csv` attachment with `team_id`, `team`, `pathway`, `status`, `score_exact`, `score`, `rank`, `awards`, `project_name`, `demo_url`, and `repo_url`. Cells that begin with a spreadsheet formula prefix are prefixed with an apostrophe so participant-controlled text cannot execute when the file is opened |

#### GET `/api/admin/preflight`

Event-readiness checks for a season.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.all` |
| **Query** | Optional `season_id` |
| **Response** | `AdminPreflightResponse` — submitted teams, teams below the three-evaluation feedback minimum, total evaluations, judges with evaluations, assigned judges, publication/date mismatches, vote-cap feasibility, and the current gate states |

### Awards

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/awards` | `nethack.all` | List definitions |
| `POST` | `/api/admin/awards` | `nethack.all` | Create or upsert `{ namespace, name, description, icon, color }` |
| `DELETE` | `/api/admin/awards/:namespace` | `nethack.all` | Delete a definition; assigned teams block deletion with `409` |
| `GET` | `/api/admin/teams/:id/awards` | `nethack.all` | List a team's awards |
| `POST` | `/api/admin/teams/:id/awards` | `nethack.all` | Assign `{ award, meta? }`; duplicate assignment returns `409` |
| `DELETE` | `/api/admin/teams/:id/awards/:award` | `nethack.all` | Remove an assignment |

All award mutations write an audit row in the same transaction.

### GET `/api/admin/audit`

Read the administrative audit log, newest first.

| Field | Details |
| --- | --- |
| **Auth** | `nethack.all` |
| **Query** | Optional `season_id`; `limit` (1–200, default 50) |
| **Response** | `{ events: [{ id, actor_user_id, action, entity_type, entity_id, before, after, reason, request_id, created_at }] }` |

### Judge coverage

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/judging/assignments` | `nethack.all` | List assignments for a season; optional `season_id` and `id` |
| `POST` | `/api/admin/judging/assignments` | `nethack.all` | Create `{ judge_user_id, season_id?, pathway?, team_id? }`; pathway and team are mutually exclusive. The judge must not belong to a team in the same season, and a pathway must name a track in the season rubric. Assigning a participant promotes them to judge |
| `DELETE` | `/api/admin/judging/assignments?id=` | `nethack.all` | Remove an assignment |
| `GET` | `/api/admin/judging/flags` | `nethack.all` | List flags; optional `season_id` and `resolved` |
| `PATCH` | `/api/admin/judging/flags/:id` | `nethack.all` | Resolve an open flag |
| `GET` | `/api/admin/judging/calibration` | `nethack.all` | Judge averages, standard deviation, and outliers (`>2σ` with at least three evaluations); optional `season_id` |

A judge with no assignment rows sees every submitted project except their own team and recused teams. An assignment with neither a pathway nor a team grants all projects; otherwise the assignment narrows the queue to the listed pathway or team. Recusals always remove a team.

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

When `HACKATHON.yml` defines the live rubric, the admin response includes `yamlManaged: true` and the version-creation endpoint returns 409 for the active season. Edit the manifest to activate a different rubric.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/seasons/:id/rubric` | Get the active rubric version, season history, and reusable templates |
| POST | `/api/admin/seasons/:id/rubric` | Create and activate a version from a definition, prior season, or template |
| PATCH | `/api/admin/seasons/:id/score-curve` | Set the season's presentation-only score curve preset |
| GET/POST | `/api/admin/rubric-templates` | List reusable templates or create one |
| PUT/DELETE | `/api/admin/rubric-templates/:id` | Update or delete a reusable template |

### GET `/api/admin/hackathon`

Read live hackathon configuration and all seasons. The response includes `configSource` (`local`, `remote`, or `database`).

| Field        | Details                                       |
| ------------ | --------------------------------------------- |
| **Auth**     | Admin                                         |
| **Response** | `{ hackathon: Hackathon, seasons: Season[] }` |

### PATCH `/api/admin/hackathon`

Update settings for a live or stored season. All editable fields, including the schedule, theme, announcement, operational switches, vote cap, and results visibility, are stored in PostgreSQL and apply immediately to the live season. The manifest seeds and is compared against these values but is never rewritten, so a remote manifest no longer blocks any field.

Setting `results_published = 1` for the first time writes `results_published_at` and a `results_snapshot` of the standings. Unless the same request supplies them, it also sets `judging_open = 0` and `voting_enabled = 0`, freezing both. Setting `results_published = 0` after publication clears `results_published_at` and `results_snapshot`, allowing the season to be reopened or republished. It then notifies current members of submitted teams; a notification failure is logged but does not roll back the published results. Schedule and theme fields are ordinary live settings and never write to `HACKATHON.yml`. Nullable text fields (`announcement`, `theme_name`, `theme_description`, `schedule_start`, `schedule_end`) accept an explicit `null` to clear them. The route rejects schedule ranges that end before they start. Historical and future seasons keep their own stored settings and additionally require the season-update permission.

| Field        | Details                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Auth**     | Admin; a non-active `season_id` also requires the season-update permission |
| **Body**     | Partial `AdminUpdateHackathonRequest` (all fields optional) + `season_id?` |
| **Response** | `{ hackathon: Hackathon, seasons: Season[] }`                              |

### POST `/api/admin/seasons`

Create a new season. With `copy_live_settings` (the default), the season copies only the active season's schedule, theme, and an immutable copy of its rubric. Every operational switch starts off (`not_started`, voting/judging/results/visibility off, vote cap 0, announcement cleared, curve `original`), so a new season never inherits the previous event's state. A blank-start season copies nothing and starts with no rubric. Creating an already-active season additionally requires the season-activate permission; if activation fails, the newly inserted season is removed.

| Field        | Details                                                              |
| ------------ | -------------------------------------------------------------------- |
| **Auth**     | Admin; `is_active: 1` also requires the season-activate permission   |
| **Body**     | `{ name: string, is_active?: 0 \| 1, copy_live_settings?: boolean }` |
| **Response** | `{ seasons: Season[] }`                                              |

### PATCH `/api/admin/seasons`

Rename, activate, or deactivate a season. Any `is_active` change additionally requires the season-activate permission.

| Field | Details |
| --- | --- |
| **Auth** | Admin; `is_active` changes require the season-activate permission |
| **Body** | `{ id: number, name?: string, is_active?: 0 \| 1, max_team_members?: number }` (roster cap 1–20) |
| **Response** | `{ seasons: Season[] }` |

### PATCH `/api/admin/seasons/:id/approval`

Record or revoke board approval for a blank-start season. The server records the authenticated administrator's user ID and the approval timestamp. Approval cannot be revoked while that season is active.

| Field          | Details                                        |
| -------------- | ---------------------------------------------- |
| **Auth**       | `nethack.Seasons.update`                       |
| **Validation** | `{ approved: boolean }`                        |
| **Response**   | `{ id, board_approved_at, board_approved_by }` |
| **Rate limit** | Yes                                            |

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
| **Response** | Streamed JSON snapshot or `text/csv` with per-table sections; judge identities, resolution actors, and staff references inside audit payloads are removed, draft evaluations are excluded, and formula-like CSV values are neutralized. The export is generated lazily inside one read-only `REPEATABLE READ` transaction with backpressure, so it neither accumulates in memory nor repeats or omits rows under concurrent writes |

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
| GET | `/api/debug/deepseek/sessions` | `nethack.Debug.deepseekRead` or `nethack.all` | List the caller's sessions |
| GET | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekRead` or `nethack.all` | Get session with messages |
| DELETE | `/api/debug/deepseek/sessions/:id` | `nethack.Debug.deepseekWrite` or `nethack.all` | Delete a session |
| POST | `/api/debug/deepseek/sessions/:id/message` | `nethack.Debug.deepseekWrite` or `nethack.all` | Send a message `{ message, role?, toolCallId?, toolResult? }` |

Sessions are owned by the operator who created them. Listing returns only that operator's sessions, and reading, deleting, or messaging another operator's session returns 404. These routes are disabled in production.

---

## Retired webhooks

The Microsoft Graph integration and both webhook handlers were removed. `POST /api/_webhooks/update` and `POST /api/_webhooks/lifecycle` remain registered only to close the public paths and always return `404 Not Found`.

---

## Operational routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health/live` | None | Process liveness; `{ status: "ok" }`, plus uptime when `HEALTH_DETAILS` is truthy. Never checks the database |
| `GET` | `/api/health/ready` | None | Runs `select 1` with a two-second deadline; `{ status: "ok" }` or `503 { status: "unavailable" }` |
| `GET` | `/calendar.ics` | None | RFC 5545 calendar of scheduled event start, submission close, voting start/end, and results release |
| `GET` | `/.well-known/security.txt` | None | RFC 9116 security contact, cached for one day |
| `GET` | `/sitemap.xml` | None | Public pages plus `/projects` after the event enters peer voting and `/results` after publication; past-season archives remain listed |
| `GET` | `/docs/*` | Judge or administrator | Protected VitePress documentation |

Health responses set `Cache-Control: no-store`. The readiness check reports no database details.

---

<TerminalWindow title="nethack@api-test:~" prompt="$">

```bash
# Quick health check
curl -s https://localhost:24598/api/seasons/active | jq .

# List teams (authenticated)
curl -s -H "Cookie: session=..." \
  https://localhost:24598/api/teams
```

</TerminalWindow>
