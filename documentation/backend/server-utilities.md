---
title: Server Utilities
description: All server-side utility modules in the nethack backend
---

# Server Utilities

All server utilities live in `server/utils/`. They provide shared functionality for API routes, plugins, and middleware.

---

## auth.ts

Authentication and authorization helpers enforce verified basis-auth JWT permissions. All functions are async and return the bearer-linked DB user row on success.

### `requireUser`

```ts
export async function requireUser(
    event: H3Event,
    permissions?: PermissionRequirement,
): Promise<User>;
```

Requires `Authorization: Bearer …`, validates the basis-auth access token, optionally enforces the required `nethack.*` JWT permission, and resolves the stable `sub` to the linked local user. The Nuxt cookie is not consulted for API authorization.

**Flow:**

1. Verify RS256, issuer, `devconnect://nethack.bisz.dev` audience, expiry, token type, and basis-schema claims.
2. Evaluate the required access from the JWT `permissions` array.
3. Resolve issuer and `sub` to a linked local user.

---

## Database layer

The database layer uses Drizzle ORM. The canonical schema lives in `server/database/schema.ts`, initialization and migrations live in `server/database/migrate.ts`, and the validated bounded PostgreSQL pool is created in `server/database/index.ts`.

### `createDrizzleDatabase`

```ts
export async function createDrizzleDatabase(): Promise<DrizzleDatabase>;
```

Creates the process-wide Drizzle ORM instance backed by a bounded `postgres` connection pool. It validates the PostgreSQL URL and pool size before connecting. Connections use `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 30s`, a 20-second idle timeout, a 30-minute maximum lifetime, and `prepare: false`.

### Database observability

`DATABASE_METRICS=1` installs bounded query and pool-acquisition histograms plus a slow-query logger. Slow queries above `DATABASE_SLOW_QUERY_MS` (default 250) log the duration and threshold, never the SQL text, and are capped at 20 lines per minute.

### Query helpers

`server/utils/database/query.ts` provides `firstRow`, `changedRows`, `lockForUpdateIfSupported`, `supportsRowLocks`, `isUniqueViolation`, `databaseErrorCodes`, `requestCache`, and `invalidateRequestCaches`. `requestCache(event, key, load)` memoizes one lookup for the request in a `WeakMap`; a rejected load is evicted so a later caller can retry. `invalidateRequestCaches(event)` clears the scope after a write that the request later reads back.

### `getDb`

```ts
export async function getDb(): Promise<DrizzleDatabase>;
```

Alias for `createDrizzleDatabase`.

### Runtime attachment

The `init-database` Nitro plugin attaches the same Drizzle instance to `event.context.drizzle` on every request. All database operations go through that instance.

---

## convert.ts

Transforms internal database rows into public API response objects.

### `parseProfileTheme`

```ts
function parseProfileTheme(input?: string): ProfileTheme;
```

Parses a `"mode|value"` string from the database into a `{ mode, value }` object.

- Allowed modes: `'url'`, `'emoji'`, `'gradient'`.
- Falls back to `{ mode: 'emoji', value: '' }` for invalid or missing input.

### `convertUserToPublic`

```ts
export function convertUserToPublic(
    user: User,
    options?: { includeEmail?: boolean; includeTeam?: boolean },
): APIUser;
```

Strips internal fields from a `User` row and returns a public `APIUser`:

| Output Field      | Source                                               |
| ----------------- | ---------------------------------------------------- |
| `id`              | `user.id`                                            |
| `email`           | `user.email` (omitted when `includeEmail` is false)  |
| `name`            | `user.name`                                          |
| `team_id`         | `user.team_id` (omitted when `includeTeam` is false) |
| `profile_theme`   | Parsed from `user.profile_theme`                     |
| `profile_picture` | `user.profile_picture`                               |

### `convertTeamToPublic`

```ts
export function convertTeamToPublic(
    team: Team,
    options: { withScore?: boolean; withRank?: boolean } | boolean = {},
    awards: ResolvedAward[] = [],
): APITeam;
```

Converts a `Team` row to a public `APITeam`. A boolean second argument is treated as `withScore`; the object form controls score and rank independently (`withRank` defaults to true). Pass resolved awards to include them in the `awards` array.

| Output Field | Source                                                         |
| ------------ | -------------------------------------------------------------- |
| `id`         | `team.id`                                                      |
| `name`       | `team.name`                                                    |
| `pathway`    | `team.pathway`                                                 |
| `rank`       | `team.rank`                                                    |
| `score`      | `team.score` (only if `withScore`) or `null`                   |
| `season_id`  | `team.season_id`                                               |
| `project`    | Nested object from `project_name`, `project_description`, etc. |
| `awards`     | Resolved awards with `team_id` stripped                        |

The `project` object also includes `submitted` (boolean) and `sourcing`.

---

## rateLimit.ts

In-memory fixed-window rate limiting with pre-configured tiers. A request reads and increments one bucket, so both operations are O(1).

### Built-in tier configurations

| Config Constant | Default Limit | Environment Variable | Prefix | Used By |
| --- | --- | --- | --- | --- |
| `DEFAULT_RATE_LIMIT_CONFIG` | 1200 req/min | `RATE_LIMIT_GENERAL_MAX` | (none) | General API handlers |
| `JUDGING_DRAFT_RATE_LIMIT_CONFIG` | 1200 req/min | `RATE_LIMIT_GENERAL_MAX` | `judging-draft` | `GET`, `PUT`, and `DELETE /api/judging/drafts/:teamId`; isolated per-user bucket for autosave |
| `AUTH_RATE_LIMIT_CONFIG` | 200 req/min | `RATE_LIMIT_AUTH_MAX` | `auth` | Authentication routes |
| `VOTE_RATE_LIMIT_CONFIG` | 300 req/min | `RATE_LIMIT_VOTE_MAX` | `vote` | `/api/ballot`, `/api/teams/:id/scores` |
| `UPLOAD_RATE_LIMIT_CONFIG` | 100 req/min | `RATE_LIMIT_UPLOAD_MAX` | `upload` | Upload routes |
| `BACKCHANNEL_RATE_LIMIT_CONFIG` | 600 req/min | `RATE_LIMIT_BACKCHANNEL_MAX` | `backchannel` | basis-auth backchannel receiver |
| `REQUEST_GATE_RATE_LIMIT_CONFIG` | 6000 req/min per IP | `RATE_LIMIT_REQUEST_GATE_MAX` | `gate` | Pre-body gate on `/api/*` |

### Configuration interface

```ts
interface RateLimitConfig {
    maxRequests: number; // Default: 1200 (from RATE_LIMIT_GENERAL_MAX)
    windowMs: number; // Default: 60000 (1 minute, from RATE_LIMIT_WINDOW_MS)
    keyPrefix?: string; // Optional prefix for the client identifier
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}
```

### `getClientIdentifier`

```ts
export async function getClientIdentifier(event: H3Event): Promise<string>;
```

Returns a unique identifier for the client:

1. **Session user**: `user:{id}` — read from the basis-auth session when available.
2. **IP address**: `ip:{address}` — the socket peer by default. Set `TRUSTED_PROXY_HOPS` to the exact 0–10 proxy count to select the entry that many positions from the right of a valid `x-forwarded-for` chain.

An explicit `Authorization` header never keys the limiter: a route has not verified that token yet, so a caller could rotate arbitrary values to reset its bucket. API clients are limited by IP until their token or cookie session is validated.

This ensures authenticated users are not rate-limited by other users' activity behind a shared NAT, while unauthenticated users are still protected at the IP level.

### `applyRateLimit`

```ts
export function applyRateLimit(
    handler: (event: H3Event) => Promise<any>,
    config?: Partial<RateLimitConfig>,
): (event: H3Event) => Promise<any>;
```

Wraps an API handler with rate limiting. Returns 429 with a `Retry-After` header when exceeded.

**Features:**

- Per-identifier fixed windows with O(1) increment and reset.
- Optional custom `keyGenerator` and `keyPrefix`.
- Map insertion order doubles as an LRU list; the map is capped at 10,000 keys and trims to 9,000.
- `maxRequests <= 0` is treated as always-limited.
- `consumeRateLimit(identifier, config, now?)` exposes the same decision without an H3 event; the pre-body gate uses it.

### `clearRateLimitHistory`

```ts
export function clearRateLimitHistory(): void;
export function getTrackedRateLimitKeys(): number;
```

Clear or inspect the in-memory counters. Exposed primarily for tests.

## event-state.ts

Resolves the event gates once per request and caches the result in a `WeakMap` keyed by the event.

```ts
interface EventGates {
    paused: boolean;
    submissionsOpen: boolean;
    submissionsClosed: boolean;
    votingOpen: boolean;
    judgingOpen: boolean;
    galleryPublic: boolean;
    resultsVisible: boolean;
}
```

- Submissions require `not_started` or `in_progress`, not `paused`, and `now <= end_timestamp + SUBMISSION_GRACE_MS` when deadlines are enforced.
- `/api/seasons/active` and the team endpoints expose the gallery gate. The active-season gallery and team detail are private to members, judging staff, and administrators until the event enters peer voting, even if the submission deadline has passed while the season is still in progress.
- Voting closes at `voting_end_timestamp`; judging is frozen after publication in a finished season unless `JUDGING_AFTER_PUBLISH` is on.
- `invalidateEventStateCache(event)` clears the request cache after a settings mutation.

## audit.ts

`writeAuditEvent(db, event, entry)` appends an `admin_audit_events` row inside the caller's transaction. It stores the validated actor ID, a stable action and entity, optional before/after JSON, an optional reason, and the request ID. Payloads are bounded at this boundary: strings are truncated to 500 characters, collections and nesting are capped, and an oversized payload becomes `{ truncated: true, preview }`. Never include secrets in the payloads.

## notifications.ts

- `createNotification(db, userId, input)`
- `notifyUserByEmail(event, { email, ...input })` — silently skips an address without an account
- `notifyTeamOwner(event, team, input)` — falls back to the earliest current member when ownership is unset
- `notifySeasonParticipants(event, seasonId, input)` — batches current members of submitted teams in chunks of 250, respects `NOTIFICATIONS_ENABLED`, and dispatches one webhook announcement for the batch
- `deleteNotificationsForUsers(db, userIds)`

---

## basis-auth.ts and oauth2.ts

`basis-auth.ts` owns OIDC discovery, confidential-client configuration, S256 PKCE requests, callback validation, UserInfo loading, token refresh rotation, and revocation. `basis-auth-session.ts` seals token sets into a compressed AES-256-GCM HTTP-only cookie. `oauth2.ts` contains the public-origin helper.

### Public origin / issuer

```ts
export function getPublicOrigin(): string;
export function getBasisAuthCallbackUrl(): string;
export function getBasisAuthInternalConfig():
    | { internalUrl: string; resourceSecret: string }
    | undefined;
```

`getPublicOrigin()` normalizes `CURRENT_URL_ORIGIN`; `getBasisAuthCallbackUrl()` appends `/api/auth/basis/callback`. `getBasisAuthInternalConfig()` returns the private listener settings, or `undefined` when `BASIS_AUTH_INTERNAL_URL` and `BASIS_AUTH_RESOURCE_SECRET` are not both set.

### Backchannel and revocation state

```ts
// basis-auth-jwks.ts
export function getBasisAuthJwks(issuer: string): RemoteJWKSet;
export async function verifyBasisAuthJwt(
    token: string,
    options: { typ: string; audience: string },
): Promise<JWTPayload>;

// basis-auth-backchannel.ts
export function handleBackchannelTest(form: URLSearchParams): void;
export function sendBasisAuthWebhookProof(nonce: string, challenge: string): Promise<void>;
export async function applyBasisAuthLogoutToken(event: H3Event, token: string): Promise<void>;
export async function applyBasisAuthAccessTokenRevocation(
    event: H3Event,
    form: URLSearchParams,
): Promise<void>;

// basis-auth-state.ts
export function invalidAccessToken(): never;
export async function isAccessTokenRevoked(event: H3Event, jti: string): Promise<boolean>;
export async function revokeAccessToken(
    event: H3Event,
    input: { jti: string; validAfter: number; expiresAt: number | null },
): Promise<void>;
export async function endBasisAuthSubjectSessions(event: H3Event, subject: string): Promise<void>;
export async function assertAccessTokenActive(
    event: H3Event,
    claims: Pick<AccessTokenClaims, "sub" | "iat" | "jti">,
): Promise<void>;
```

`verifyBasisAuthJwt` is the single RS256/issuer/`typ` verifier used by both the access-token path and the backchannel events. `assertAccessTokenActive` combines the `revoked_access_tokens` denylist, the per-subject `users.tokens_valid_after` logout barrier, and the live `disabled` / `tokensValidAfter` state from the basis-auth private listener. The listener lookup is cached for one minute per subject and fails closed, with a 15-second backoff after a failure.

---

## oauth2-jwt.ts

JWT verification and OAuth2 Bearer token handling using the `jose` library.

### `verifyAccessToken`

```ts
export async function verifyAccessToken(token: string, event: H3Event): Promise<OAuth2JWTPayload>;
```

Verifies a basis-auth access token against its remote JWKS, requiring RS256, exact issuer and resource audience, `typ=at+jwt`, expiry, and the shared `@basis/schema` claims contract. It then applies `assertAccessTokenActive`, so deny-listed `jti` values, tokens older than a backchannel logout barrier, and disabled basis-auth users are rejected too. The wrapper can enforce OAuth scopes and shared delegated permissions independently. Throws 401 for invalid, revoked, or expired tokens.

### `extractBearerToken`

```ts
export function extractBearerToken(event: H3Event): string;
```

Extracts the Bearer token from the `Authorization` header. Throws 401 if missing or malformed.

### `verifyOAuth2JWT`

```ts
export async function verifyOAuth2JWT(event: H3Event): Promise<OAuth2JWTPayload>;
```

Combines `extractBearerToken` and `verifyAccessToken` into a single call.

### `resolveOAuth2User`

```ts
export async function resolveOAuth2User(event: H3Event, payload: OAuth2JWTPayload): Promise<User>;
```

Resolves a user from the JWT payload's `user_id` or `sub` field. Throws 401 (`invalid_token`) if the payload has no valid user ID or if no local user is linked to the basis-auth subject. On the standard authenticated request path it reuses the full user row already fetched and verified by `assertAccessTokenActive`, avoiding a second identical lookup; the reuse is guarded by the token subject so a different token on the same event can never inherit another user's row.

**Context attached to `event.context.oauth2`:**

| Field         | Type               | Description               |
| ------------- | ------------------ | ------------------------- |
| `payload`     | `OAuth2JWTPayload` | Verified JWT payload      |
| `permissions` | `string[]`         | JWT permission array      |
| `user`        | `User`             | Bearer-linked DB user row |

---

## profile.ts

Profile picture generation using jdenticon.

### `generateIdenticonPNG`

```ts
export async function generateIdenticonPNG(name: string, size?: number): Promise<Buffer>;
```

Generates a deterministic identicon PNG from a name string and saves it as a user asset.

- Default size: 100px.
- The name is sanitized to filesystem-safe characters.
- The returned PNG is stored by the calling code under project-root `/assets`; runtime uploads are gitignored and separate from `public/assets`.

---

## assets.ts

File system helpers for managing persistent static and user assets with path traversal and symlink protection.

### Storage location and path protection

All runtime collections are rooted at `<project-root>/assets`: public uploads are in `assets/`, while user uploads are in `userassets/`. This path is fixed rather than configured through an environment variable. Keep it through in-place pull/build/start deployments, back it up separately from PostgreSQL, and restore it before serving from a fresh clone. The committed static showcase under `public/assets` is unrelated runtime storage.

Asset names may include safe nested path segments, but empty, `.` and `..` segments, backslashes, NUL bytes, and names over 512 characters are rejected. Resolved paths are checked to stay inside their collection. Parent directories and final files are checked against symlinks; reads use `O_NOFOLLOW` where available.

### Asset Functions

| Function | Description |
| --- | --- |
| `createAsset(name, data)` | Writes a Buffer to the checked project-root `assets/` collection; returns the stored name |
| `createUserAsset(name, data)` | Writes a Buffer to the checked project-root `userassets/` collection; returns the stored name |
| `createAssetFromStream(...)` | Streams a size-limited upload to a temporary file and atomically publishes its content-addressed object |
| `getUserAssetContentAddress(data, extension)` | Derives `profiles/<sha256>.<canonical-extension>` for a profile image |
| `createUserAssetContentAddressed(...)` | Verifies and publishes a profile image object without overwriting an existing object; identical content deduplicates |
| `withAssetLifecycleLocks(...)` | Serializes a database reference update with collection of the same asset paths using PostgreSQL advisory locks |
| `collectOrphanProfileAssets(...)` | Bounded cleanup of old managed profile objects after checking every supported database reference under the lifecycle lock |
| `releaseAssetReference(...)` | Releases an owned permalink reference, or an admin-managed reference, without revealing whether another user's reference exists |
| `listAssetReferences(...)` | Returns paginated references for one owner, or every owner for an administrator |
| `collectOrphanPermalinkAssets(...)` | Legacy helper for collecting registered permalink objects. Application startup no longer schedules this collector. |
| `removeAsset(name)` / `removeUserAsset(name)` | Explicit low-level deletion helpers; do not use them for lifecycle cleanup of potentially referenced content |
| `getUserAsset(name)` | Reads a file from the checked project-root `userassets/` collection as a Buffer |
| `openStoredAsset(collection, name)` | Opens a checked file as a stream and returns its size |

Existing files are served from `/assets/uploads/*` and `/userast/*` by explicit Nitro routes that set a fixed content type, `nosniff`, a restrictive CSP, and attachment disposition for non-image/video formats. Debug upload creation has been retired. The scheduled cleanup starts one minute after database startup, then runs daily with bounded scan and deletion counts for managed profile assets and stale temporary files. Profile cleanup checks profile pictures, URL profile themes, and legacy OAuth application pictures. Published debug files remain available at their original URLs.

---

## deepseek-store.ts

In-memory store for DeepSeek AI chat sessions.

### Data Structure

```ts
interface ChatSession {
    id: number;
    sessionName: string;
    owner_user_id: number;
    createdAt: number;
    messages: ChatCompletionMessage[];
}
```

### Limits

- `MAX_SESSIONS` = 100
- `MAX_SESSIONS_PER_OWNER` = 20
- `MAX_MESSAGES_PER_SESSION` = 200
- `SESSION_TTL_MS` = 24 hours

### Functions

| Function | Description |
| --- | --- |
| `createSession(sessionName, ownerUserId)` | Creates a new session with auto-incrementing ID; sweeps expired sessions and evicts the owner's oldest before the global oldest |
| `getDeepSeekSession(sessionId)` | Returns a live session by ID after sweeping expired entries |
| `getAllSessions(ownerUserId?)` | Returns live sessions, optionally for one owner |
| `deleteSession(sessionId)` | Deletes a session; returns whether a session was removed |
| `addMessage(sessionId, message)` | Appends a message to a live session; trims history to the most recent 200 |
| `getMessages(sessionId)` | Returns a shallow copy of all messages for a live session |

Every access sweeps sessions older than the 24-hour TTL, so an expired session is never returned even when the store is below capacity.

**Note:** All data is in-memory and lost on server restart.

---

## url-validation.ts

**File:** `server/utils/url-validation.ts`

Centralized helpers for validating redirect URIs and other URLs used in OAuth2 flows and external web fetches. Provides **SSRF protection** by blocking requests to internal/private networks.

### `validateExternalUrl`

```ts
export function validateExternalUrl(urlString: string): URL;
```

Parses the URL and throws if:

- Protocol is not `http:` or `https:`.
- Host is **private or loopback** (localhost, private IP ranges, etc.) — prevents SSRF attacks by ensuring external requests cannot target internal infrastructure.

### `fetchExternalHtml`

```ts
export async function fetchExternalHtml(urlString: string, init?: RequestInit): Promise<string>;
```

Fetches raw HTML from an external URL with manual redirect handling (max 5 redirects). Returns up to 15,000 characters of the response body, or an error string on failure. Each redirect target is re-validated through `validateExternalUrl` to prevent redirect-based SSRF.

### `isPrivateHost`

```ts
function isPrivateHost(host: string): boolean;
```

Returns `true` if the host is `localhost`, a loopback address, or a private IPv4/IPv6 range. Used internally by `validateExternalUrl` and can be reused for other validation contexts.

### Private IP blocklist

The function blocks the following address ranges:

| Range            | Type              |
| ---------------- | ----------------- |
| `127.0.0.0/8`    | Loopback          |
| `10.0.0.0/8`     | Private (Class A) |
| `172.16.0.0/12`  | Private (Class B) |
| `192.168.0.0/16` | Private (Class C) |
| `::1/128`        | IPv6 loopback     |
| `fc00::/7`       | IPv6 unique local |
| `localhost`      | Hostname          |

---

## scoring.ts

**File:** `server/utils/scoring.ts`

Computes weighted judge scores and rankings for a season.

### `computeScores`

```ts
export async function computeScores(event: H3Event, seasonID: number): Promise<void>;
```

`calculateSeasonScores` reads each saved evaluation with its pinned rubric version, normalizes the configured criterion ranges, applies the per-track weights, and calculates the arithmetic mean across judges. It ranks by exact score, then the highest-weight criterion, submission time, and team ID; teams with identical results share a competition rank, and `withdrawn`, `disqualified`, and `no_show` teams receive no rank.

`calculateSeasonScoresWithDatabase` writes a batch of 250 teams per statement using `UPDATE ... FROM (VALUES ...)`. This avoids evaluating one CASE arm per team and keeps the transaction's touch count proportional to the number of batches. A judge finalization reads only that project's saved evaluations plus current track values; the authorized admin recompute action rebuilds the full season.

---

## Database Helpers

Per-table database helper modules in `server/utils/database/`.

### users.ts

| Function | Description |
| --- | --- |
| `getUser(event, userID)` | Get user by ID |
| `getUserByEmail(event, email)` | Get user by email (case-insensitive) |
| `findOrLinkBasisAuthUser(event, identity)` | Resolve a user by issuer/subject or link the first verified login by normalized email |
| `getUserByBasisAuthSubject(event, issuer, subject)` | Resolve a linked user by stable basis-auth identity |
| `updateUserName(event, user)` | Update user's name |
| `updateUserProfileTheme(event, user)` | Update user's profile theme |
| `updateUserProfilePicture(event, user)` | Update user's profile picture |
| `deleteUsers(event, userIDs)` | Delete users and their related records, detach legacy OAuth2 applications, and refuse to remove the last administrator |
| `findOrLinkBasisAuthUser` | Also applies `INITIAL_ADMIN_EMAILS` elevation at sign-in |

### teams.ts

| Function | Description |
| --- | --- |
| `getTeam(event, teamID, allSeason?)` | Get team by ID (active season by default; pass `true` for any season) |
| `getAllTeams(event)` | Get all teams for active season |
| `getSubmittedUnjudgedTeams(event, judgeUserID)` | Get submitted teams not yet scored by a judge |
| `getSubmittedTeams(event)` | Get all submitted teams for active season |
| `getTeamById(event, teamID)` | Get team by ID (any season) |
| `getTeamBySeason(event, teamID, seasonId)` | Get team by ID and season |
| `getAllTeamsAllSeasons(event)` | Get all teams across all seasons |
| `getTeamsBySeason(event, seasonId)` | Get teams by season ID |
| `createTeam(event, teamName, ownerUserID)` | Create a new team in the active season with its owner |
| `canManageTeam(team, user)` | Owner check; a legacy team without an owner remains manageable by its members |
| `transferTeamOwnership(event, teamID, userID)` | Move roster controls to another current member |
| `disbandTeam(event, teamID)` | Record member history, detach members, delete invitations, and set `status = 'withdrawn'` |
| `updateTeamPartial(event, teamID, seasonID, updates, options?)` | Update only the supplied team columns; optional active/unsubmitted guards |
| `deleteTeams(event, teamIDs)` | Delete teams and related records |

### scores.ts

| Function                                   | Description                 |
| ------------------------------------------ | --------------------------- |
| `createTeamScores(event, scores)`          | Create a judge score record |
| `getTeamScoresByTeamID(event, teamID)`     | Get all scores for a team   |
| `getTeamScoresBySeasonId(event, seasonID)` | Get all scores for a season |

### members.ts

| Function | Description |
| --- | --- |
| `getTeamMembers(event, teamID)` | Get current team members |
| `getAllTeamMembers(event, teamID)` | Get current and past team members |
| `getUserPastTeams(event, userID)` | Get teams a user was previously in |
| `addUserPastTeam(event, userID, teamID)` | Record a past team membership |
| `removeTeamMember(event, teamID, userID)` | Remove a member (records past team first); rejects removing the last member with 409 so the team cannot be orphaned |
| `addTeamMember(event, teamID, userID)` | Add a member to a team, allowing a pointer from an earlier season |
| `getTeamMemberLimit(event)` | Read the active season's `max_team_members`, with the historical default as a fallback |
| `createTeamInvite(event, teamID, email, invitedBy)` | Store a SHA-256 token digest and expiry; return the raw token once |
| `getTeamInvites(event, teamID)` | List non-expired invitations without tokens |
| `acceptTeamInvite(event, inviteID, user)` | Accept by row ID after email, expiry, season, status, and capacity checks |
| `acceptTeamInviteByToken(event, token, user)` | Accept by hashing the raw token and matching its digest |
| `declineTeamInvite(event, inviteID, email)` | Delete an invitation addressed to the caller |

### hackathon.ts

| Function | Description |
| --- | --- |
| `getHackathon(event)` | Read live settings from YAML or the PostgreSQL rollback source; merged once per request and reused by repeated read helpers |
| `invalidateHackathonCache(event)` | Drop the per-request cached state after a route mutates hackathon or season settings |
| `updateHackathon(event, data)` | Update live settings in PostgreSQL rollback mode |

### ballots.ts

| Function                                        | Description                              |
| ----------------------------------------------- | ---------------------------------------- |
| `createBallot(event, userID)`                   | Create a ballot for a user               |
| `getBallotByUser(event, userID)`                | Get a user's ballot                      |
| `updateBallot(event, ballot)`                   | Update ballot reasoning/submitted status |
| `createBallotScore(event, ballotID, projectID)` | Create a ballot score entry              |
| `getBallotScores(event, ballotID)`              | Get all scores for a ballot              |
| `getBallotScoresByTeamID(event, teamID)`        | Get all ballot scores for a team         |
| `updateBallotScore(event, score)`               | Update a ballot score value              |

### seasons.ts

| Function | Description |
| --- | --- |
| `getSeasons(event)` | List all seasons ordered by ID |
| `getSeasonById(event, seasonId)` | Get a season by ID |
| `getActiveSeason(event)` | Get the currently active season |
| `setActiveSeason(event, seasonId)` | Set or clear the active season and snapshot the outgoing live YAML settings |
| `updateSeasonTweaks(event, seasonId, data)` | Update a season's stored settings. Live edits are rejected in YAML mode. |
| `getScoreRankVisibilityResolver(event)` | Returns a `(seasonId) => { showScores, showRanking }` resolver that reads each season's own toggles, using live YAML for the active season. Unknown seasons keep results private in YAML mode. Used by the teams and users endpoints to bind score/rank visibility to each team's own season |

`SEASON_TWEAK_FIELDS` lists the tweakable columns shared by the `seasons` and `hackathon` tables.

### judging.ts

`getJudgeScope(db, seasonId, judgeUserId)` returns `{ assigned, allProjects, teamIds, pathways, recusedTeamIds, conflictTeamIds }`. `judgeScopeWhere(scope)` turns it into a SQL predicate, and `judgeCanEvaluate(scope, team)` applies the same rule in memory. `conflictTeamIds` contains teams the judge belonged to earlier in the same season; they are never evaluated. With no assignment rows, all submitted projects remain visible. An assignment with neither a pathway nor a team grants all projects; otherwise it narrows to the listed pathway or team. Recusals always remove a team. `assertJudgeNotCompeting(event, user, seasonId)` rejects an action when the judge's current team belongs to that season; administrators are exempt. `isJudgingOpen(hackathon, season)` applies the paused, switch, and publication rules.

### judge-flags.ts

`upsertJudgeFlag`, `resolveJudgeFlag`, and `getJudgeFlags` manage the organizer conflict queue. Upserting reopens a resolved flag, writes a `judging.flag` audit row, and notifies every administrator. Resolution writes `judging.flag_resolved`.

### peer-voting.ts

**File:** `server/utils/database/peer-voting.ts`

| Function                           | Description                                               |
| ---------------------------------- | --------------------------------------------------------- |
| `getPeerVoteByUser(event, userID)` | Get a peer voting record by user ID                       |
| `upsertPeerVote(event, vote)`      | Insert or update a peer vote (`peer_voting_scores` table) |

### awards.ts

**File:** `server/utils/database/awards.ts`

| Function                                  | Description                            |
| ----------------------------------------- | -------------------------------------- |
| `getAwards(event, teamId)`                | Get resolved awards for a single team  |
| `getAwardsForTeams(event, teamIds)`       | Get resolved awards for multiple teams |
| `createAward(event, teamId, award, meta)` | Create a team award                    |
| `deleteTeamAwards(event, teamId)`         | Delete all awards for a team           |
| `deleteAward(event, teamId, award)`       | Delete a specific award for a team     |

Award definitions live in the PostgreSQL `awards` table and are managed through `/api/admin/awards`.
