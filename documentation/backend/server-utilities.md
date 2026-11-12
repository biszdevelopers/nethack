---
title: Server Utilities
description: All server-side utility modules in the basishacks backend
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

Creates the process-wide Drizzle ORM instance backed by a bounded `postgres` connection pool. It validates the PostgreSQL URL and pool size before connecting.

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
export function convertUserToPublic(user: User): APIUser;
```

Strips internal fields from a `User` row and returns a public `APIUser`:

| Output Field      | Source                           |
| ----------------- | -------------------------------- |
| `id`              | `user.id`                        |
| `email`           | `user.email`                     |
| `role`            | `user.role`                      |
| `name`            | `user.name`                      |
| `team_id`         | `user.team_id`                   |
| `profile_theme`   | Parsed from `user.profile_theme` |
| `profile_picture` | `user.profile_picture`           |

### `convertTeamToPublic`

```ts
export function convertTeamToPublic(
    team: Team,
    withScore: boolean = false,
    awards: ResolvedAward[] = [],
): APITeam;
```

Converts a `Team` row to a public `APITeam`. The `withScore` parameter controls whether the score is included (default: `false`). Pass resolved awards to include them in the `awards` array.

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

In-memory rate limiting middleware with five pre-configured tiers.

### Built-in tier configurations

| Config Constant | Default Limit | Environment Variable | Prefix | Used By |
| --- | --- | --- | --- | --- |
| `DEFAULT_RATE_LIMIT_CONFIG` | 120 req/min | `RATE_LIMIT_GENERAL_MAX` | (none) | General API handlers |
| `JUDGING_DRAFT_RATE_LIMIT_CONFIG` | 120 req/min | `RATE_LIMIT_GENERAL_MAX` | `judging-draft` | `GET`, `PUT`, and `DELETE /api/judging/drafts/:teamId`; isolated per-user bucket for autosave |
| `AUTH_RATE_LIMIT_CONFIG` | 20 req/min | `RATE_LIMIT_AUTH_MAX` | `auth` | Authentication routes |
| `VOTE_RATE_LIMIT_CONFIG` | 30 req/min | `RATE_LIMIT_VOTE_MAX` | `vote` | `/api/ballot`, `/api/teams/:id/scores` |
| `UPLOAD_RATE_LIMIT_CONFIG` | 10 req/min | `RATE_LIMIT_UPLOAD_MAX` | `upload` | Upload routes |

### Configuration interface

```ts
interface RateLimitConfig {
    maxRequests: number; // Default: 120 (from RATE_LIMIT_GENERAL_MAX)
    windowMs: number; // Default: 60000 (1 minute, from RATE_LIMIT_WINDOW_MS)
    keyPrefix?: string; // Optional prefix for the client identifier
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}
```

### `getClientIdentifier`

```ts
export async function getClientIdentifier(event: H3Event): Promise<string>;
```

Returns a unique identifier for the client using a two-tier strategy:

1. **Authenticated requests**: `user:{id}` — extracted from the basis-auth session via `readBasisAuthUserSession(event)`.
2. **Unauthenticated requests**: `ip:{address}` — uses the direct socket peer by default, or `unknown`. Set `TRUSTED_PROXY_HOPS` to the exact 0–10 proxy count to select the first untrusted address from a valid `x-forwarded-for` chain.

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

- Per-identifier request tracking with sliding window.
- Optional custom `keyGenerator` and `keyPrefix`.
- Interval-based cleanup of stale entries every 5 minutes.
- Hard cap of 10,000 tracked keys to prevent unbounded memory growth.
- `maxRequests <= 0` is treated as always-limited.

### `clearRateLimitHistory`

```ts
export function clearRateLimitHistory(): void;
```

Clears the in-memory rate limit history. Exposed primarily for tests.

---

## basis-auth.ts and oauth2.ts

`basis-auth.ts` owns OIDC discovery, confidential-client configuration, S256 PKCE requests, callback validation, UserInfo loading, token refresh rotation, and revocation. `basis-auth-session.ts` seals token sets into a compressed AES-256-GCM HTTP-only cookie. `oauth2.ts` contains the public-origin helper.

### Public origin / issuer

```ts
export function getPublicOrigin(): string;
export function getBasisAuthCallbackUrl(): string;
```

`getPublicOrigin()` normalizes `CURRENT_URL_ORIGIN`; `getBasisAuthCallbackUrl()` appends `/api/auth/basis/callback`.

---

## oauth2-jwt.ts

JWT verification and OAuth2 Bearer token handling using the `jose` library.

### `verifyAccessToken`

```ts
export async function verifyAccessToken(token: string): Promise<OAuth2JWTPayload>;
```

Verifies a basis-auth access token against its remote JWKS, requiring RS256, exact issuer and resource audience, `typ=at+jwt`, expiry, and the shared `@basis/schema` claims contract. The wrapper can enforce OAuth scopes and shared delegated permissions independently. Throws 401 for invalid or expired tokens.

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

Resolves a user from the JWT payload's `user_id` or `sub` field. Throws 401 if the payload has no valid user ID, or 404 if the user is not found.

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
- Saved to `{ASSET_STORAGE_DIR}/assets/users/{safeName}.png` outside the release directory.

---

## assets.ts

File system helpers for managing persistent static and user assets with path traversal and symlink protection.

### Storage location and path protection

Set `ASSET_STORAGE_DIR` to an absolute directory on persistent storage outside the application release. The default is `${XDG_DATA_HOME}/basishacks/assets`, or `~/.local/share/basishacks/assets` when `XDG_DATA_HOME` is unset. Production rejects a storage root located inside `process.cwd()`.

Asset names may include safe nested path segments, but empty, `.` and `..` segments, backslashes, NUL bytes, and names over 512 characters are rejected. Resolved paths are checked to stay inside their collection. Parent directories and final files are checked against symlinks; reads use `O_NOFOLLOW` where available.

### Asset Functions

| Function | Description |
| --- | --- |
| `createAsset(name, data)` | Writes a Buffer to `{ASSET_STORAGE_DIR}/assets/{name}`; returns basename |
| `createUserAsset(name, data)` | Writes a Buffer to `{ASSET_STORAGE_DIR}/userassets/{name}`; returns basename |
| `createAssetFromStream(...)` | Streams a size-limited upload to a temporary file and atomically publishes it |
| `removeAsset(name)` | Deletes a file from the persistent `assets/` collection |
| `removeUserAsset(name)` | Deletes a file from the persistent `userassets/` collection |
| `getUserAsset(name)` | Reads a file from persistent `userassets/` as a Buffer |
| `openStoredAsset(collection, name)` | Opens a checked file as a stream and returns its size |

Collection files are served from `/assets/uploads/*` and `/userast/*` by explicit Nitro routes that set a fixed content type, `nosniff`, a restrictive CSP, and attachment disposition for non-image/video formats. Missing assets return a not-found response. Upload parsing and limits are documented in [Debug & AI](./debug-and-ai).

---

## deepseek-store.ts

In-memory store for DeepSeek AI chat sessions.

### Data Structure

```ts
interface ChatSession {
    id: number;
    sessionName: string;
    createdAt: number;
    messages: ChatCompletionMessage[];
}
```

### Limits

- `MAX_SESSIONS` = 100
- `MAX_MESSAGES_PER_SESSION` = 200
- `SESSION_TTL_MS` = 24 hours

### Functions

| Function | Description |
| --- | --- |
| `createSession(sessionName)` | Creates a new session with auto-incrementing ID; evicts expired/oldest sessions when at capacity |
| `getDeepSeekSession(sessionId)` | Returns a session by ID |
| `getAllSessions()` | Returns all sessions |
| `deleteSession(sessionId)` | Deletes a session; returns whether a session was removed |
| `addMessage(sessionId, message)` | Appends a message to a session; trims history to the most recent 200 |
| `getMessages(sessionId)` | Returns a shallow copy of all messages for a session |

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

`calculateSeasonScores` reads each saved evaluation with its pinned rubric version, normalizes the configured criterion ranges, applies the per-track weights, and calculates the arithmetic mean across judges. Tied teams share a rank. A judge finalization reads only that project's saved evaluations plus the current track's cached score/rank values, then writes the project score and ranks that changed. This avoids reloading and recomputing every evaluation in the season for each submitted ballot. The authorized admin recompute action still uses `computeScores` to rebuild the full season and persists results in batches.

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
| `updateUserRole(event, userID, role)` | Update user's role |
| `deleteUsers(event, userIDs)` | Delete users and their related records, including owned OAuth2 applications |

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
| `createTeam(event, teamName)` | Create a new team in the active season; throws 403 if no season is active |
| `updateTeam(event, team)` | Update all team fields; throws 404 if the team does not exist |
| `deleteTeams(event, teamIDs)` | Delete teams and related records |

### scores.ts

| Function                                   | Description                 |
| ------------------------------------------ | --------------------------- |
| `createTeamScores(event, scores)`          | Create a judge score record |
| `getTeamScoresByTeamID(event, teamID)`     | Get all scores for a team   |
| `getTeamScoresBySeasonId(event, seasonID)` | Get all scores for a season |

### members.ts

| Function                                  | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| `getTeamMembers(event, teamID)`           | Get current team members                  |
| `getAllTeamMembers(event, teamID)`        | Get current and past team members         |
| `getUserPastTeams(event, userID)`         | Get teams a user was previously in        |
| `addUserPastTeam(event, userID, teamID)`  | Record a past team membership             |
| `removeTeamMember(event, teamID, userID)` | Remove a member (records past team first) |
| `addTeamMember(event, teamID, userID)`    | Add a member to a team                    |

### hackathon.ts

| Function                       | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `getHackathon(event)`          | Get the hackathon status row (single row, id=1)                |
| `updateHackathon(event, data)` | Update hackathon settings (partial) and return the updated row |

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
| `setActiveSeason(event, seasonId)` | Set the active season (pass `null` to clear); copies the newly active season's tweaks into the `hackathon` row |
| `updateSeasonTweaks(event, seasonId, data)` | Update a season's tweakable settings; also updates the `hackathon` row when the season is live |
| `getScoreRankVisibilityResolver(event)` | Returns a `(seasonId) => { showScores, showRanking }` resolver that reads each season's own toggles, falling back to the `hackathon` row when the season is missing. Used by the teams and users endpoints to bind score/rank visibility to each team's own season |

`SEASON_TWEAK_FIELDS` lists the tweakable columns shared by the `seasons` and `hackathon` tables.

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

Award definitions live in the PostgreSQL `awards` table.

### oauth2_applications.ts

| Function | Description |
| --- | --- |
| `getOAuth2ApplicationCountByOwner(event, ownerId)` | Count applications owned by a user |
| `getOAuth2Application(event, clientID)` | Get an application by client ID |
| `getAllOAuth2Applications(event)` | List all applications |
| `deleteOAuth2Applications(event, clientIDs)` | Delete applications by client ID |
| `getOAuth2ApplicationSecretAbbreviated(event, clientID)` | List abbreviated secret hashes |
| `addOAuth2ApplicationSecret(event, clientID)` | Add a new secret (SHA-256 hashed) |
| `removeOAuth2ApplicationSecret(event, clientID, abbreviated)` | Remove a secret by abbreviated hash |
| `validateOAuth2ApplicationSecret(event, clientID, plainSecret)` | Validate a secret against stored hashes |
| `getOAuth2ApplicationRedirectUris(event, clientID)` | List redirect URIs |
| `addOAuth2ApplicationRedirectUri(event, clientID, uri)` | Add a redirect URI |
| `removeOAuth2ApplicationRedirectUri(event, clientID, uri)` | Remove a redirect URI |
| `getOAuth2ApplicationScopes(event, clientID)` | List configured scopes |
| `addOAuth2ApplicationScopes(event, clientID, scopes)` | Add scopes |
| `removeOAuth2ApplicationScope(event, clientID, scope)` | Remove a scope |

**Max applications per user:** 2 (`MAX_APPLICATIONS_PER_USER`).
