---
title: Zod Schemas
description: API input validation schemas defined in shared/schemas.ts
---

# Zod Schemas

All API input validation is performed using [Zod](https://zod.dev) schemas defined in `shared/schemas.ts`. Every API endpoint must validate its input using `readValidatedBody(event, Schema.parse)` or `getValidatedQuery(event, Schema.parse)`.

::: info Source `shared/schemas.ts` :::

## Length Constants

All configurable length limits are defined as exported constants at the top of `shared/schemas.ts`, importable by both server and frontend code:

| Constant | Value | Used By |
| --- | --- | --- |
| `MAX_EMAIL_LENGTH` | 254 | `BasisEmail` |
| `MAX_PROJECT_NAME_LENGTH` | 100 | `ProjectName` |
| `MAX_PROJECT_DESCRIPTION_LENGTH` | 2,147,483,647 | `ProjectDescription`, `UpdateTeamRequest.project.description` |
| `MAX_PROJECT_SOURCE_LENGTH` | 2,147,483,647 | `UpdateTeamRequest.project.sourcing`, `SubmitTeamRequest.project.sourcing` |
| `MAX_URL_LENGTH` | 2048 | `ProjectUrl`, `RequiredProjectUrl` |
| `MAX_REASONING_LENGTH` | 2,147,483,647 | `CreateTeamScoresRequest.reasoning`, `SubmitVoteRequest.reasoning` |
| `MAX_USER_NAME_LENGTH` | 50 | `UpdateUserRequest.name` |
| `MAX_OAUTH2_CODE_LENGTH` | 1024 | `OAuth2TokenRequest.code` |
| `MAX_CLIENT_ID_LENGTH` | 256 | `OAuth2TokenRequest.client_id`, `ApplicationIdParams` |
| `MAX_CLIENT_SECRET_LENGTH` | 512 | `OAuth2TokenRequest.client_secret` |
| `MAX_CODE_VERIFIER_LENGTH` | 128 | `OAuth2TokenRequest.code_verifier` |
| `MAX_REDIRECT_URI_LENGTH` | 2048 | `OAuth2TokenRequest.redirect_uri` |
| `MAX_SCOPE_LENGTH` | 128 | (scope string validation) |
| `MAX_REASONING_LENGTH` | 2,147,483,647 | `CreateTeamScoresRequest.reasoning`, `SubmitVoteRequest.reasoning` |
| `MAX_SECRET_ABBREVIATED_LENGTH` | 16 | Abbreviated client secret display |
| `MAX_REASONING_LENGTH` | 2000 | `CreateTeamScoresRequest.reasoning`, `SubmitVoteRequest.reasoning` |
| `MAX_VOTE_SCORES` | 50 | `SubmitVoteRequest.scores` array length |
| `MAX_ELECTION_POSITIONS` | 20 | `ElectionVoteRequest.positions` array length |
| `MAX_ELECTION_CANDIDATES` | 50 | `ElectionVoteRequest.positions[].candidates` array length |
| `MAX_ELECTION_TITLE_LENGTH` | 128 | `ElectionVoteRequest.positions[].title` |
| `MAX_ELECTION_CANDIDATE_ID_LENGTH` | 64 | `ElectionVoteRequest.positions[].candidates[].id` |
| `MAX_APPLICATION_IDS_DELETE` | 100 | `DeleteApplicationsRequest.ids` array length |

## Reusable Primitives

These are building blocks composed into the request schemas below.

### `BasisEmail`

```ts
const BasisEmail = z
    .email()
    .max(MAX_EMAIL_LENGTH, "Email must be 254 characters or less")
    .refine(
        (s) => s.toLowerCase().endsWith("@basischina.com"),
        "Please use a @basischina.com email",
    );
```

A valid email (max 254 characters) that must end with `@basischina.com`. Used wherever a user email is required.

### `TeamName`

```ts
const TeamName = z
    .string()
    .min(2, "Team name must be at least 2 characters")
    .max(30, "Team name cannot be longer than 30 characters");
```

A string between 2 and 30 characters.

### `ProjectName`

```ts
const ProjectName = z
    .string()
    .min(1, "Project name is required")
    .max(MAX_PROJECT_NAME_LENGTH, "Project name cannot be longer than 100 characters");
```

A string between 1 and 100 characters.

### `ProjectDescription`

```ts
const ProjectDescription = z
    .string()
    .min(30, "Please provide more details in the description")
    .max(MAX_PROJECT_DESCRIPTION_LENGTH, "Project description cannot exceed 2000 characters");
```

A string between 30 and 2000 characters. Required for project submission.

### `ProjectUrl`

```ts
const ProjectUrl = z
    .union([z.url(), z.literal("")])
    .refine(
        (v) => v === "" || v.length <= MAX_URL_LENGTH,
        "URL cannot be longer than 2048 characters",
    );
```

A valid URL or empty string (max 2048 characters). Empty strings are transformed to `null` in `UpdateTeamRequest`.

### `RequiredProjectUrl`

```ts
const RequiredProjectUrl = z
    .url("Invalid URL format")
    .max(MAX_URL_LENGTH, "URL cannot be longer than 2048 characters");
```

A required valid URL (max 2048 characters). Used for project submission where URLs are mandatory.

### `TeamPathway`

```ts
const TeamPathway = z.enum(["junior", "senior"]);
```

Must be `'junior'` or `'senior'`.

### `BooleanString`

```ts
const BooleanString = z.enum(["true", "false"]).transform((s) => s === "true");
```

Accepts the literal strings `'true'` or `'false'` and transforms them into a boolean. Useful for query parameters.

### `ZeroToFive`

```ts
const ZeroToFive = z.number().int().min(0).max(5);
```

An integer between 0 and 5 inclusive for the legacy built-in rubric schema. Versioned season rubrics validate scores against each criterion's configured `minScore` and `maxScore` through `DynamicRubricScores` and the server-side rubric definition.

### `ScoreValues`

```ts
const ScoreValues = z.object(
    Object.keys(rubrics["junior"]).reduce(
        (obj, key) => ({ ...obj, [key]: ZeroToFive }),
        {} as Record<keyof (typeof rubrics)["junior"], typeof ZeroToFive>,
    ),
);
```

The legacy `CreateTeamScoresRequest` shape for the built-in rubric. Current judging submissions use `DynamicRubricScores`; the API verifies every criterion ID and score against the immutable rubric version attached to the season or saved draft.

### `PositiveIntParam` & Route Params

```ts
const PositiveIntParam = z.coerce.number().int().positive().finite();
```

Coerces string route params to positive integers. Used by:

| Schema                    | Params                                             |
| ------------------------- | -------------------------------------------------- |
| `TeamIdParams`            | `{ id: PositiveIntParam }`                         |
| `TeamUserParams`          | `{ id: PositiveIntParam, user: PositiveIntParam }` |
| `UserIdParams`            | `{ id: PositiveIntParam }`                         |
| `DeepSeekSessionIdParams` | `{ id: PositiveIntParam }`                         |
| `ApplicationIdParams`     | `{ id: z.string().min(1).max(256) }`               |

---

## Team Schemas

### `CreateTeamQuery`

| Field | Type            | Constraints                                                 |
| ----- | --------------- | ----------------------------------------------------------- |
| `add` | `BooleanString` | Optional. If `true`, the creating user is added to the team |

**API endpoint:** `POST /api/teams` (query parameter)

### `CreateTeamRequest`

| Field  | Type       | Constraints     |
| ------ | ---------- | --------------- |
| `name` | `TeamName` | 2–30 characters |

**API endpoint:** `POST /api/teams` (request body)

### `UpdateTeamRequest`

| Field     | Type          | Constraints                            |
| --------- | ------------- | -------------------------------------- |
| `name`    | `TeamName`    | Optional, 2–30 characters              |
| `pathway` | `TeamPathway` | Optional, `'junior'` or `'senior'`     |
| `project` | `object`      | Optional, see project sub-schema below |

**Project sub-schema:**

| Field | Type | Constraints |
| --- | --- | --- |
| `project.name` | `ProjectName` | Optional, 1–100 characters |
| `project.description` | `string` | Optional, max 2000 characters |
| `project.demo_url` | `ProjectUrl` | Optional, valid URL or empty string (transformed to `null`) |
| `project.repo_url` | `ProjectUrl` | Optional, valid URL or empty string (transformed to `null`) |
| `project.sourcing` | `string` | Optional, max 2000 characters |

**API endpoint:** `PATCH /api/teams/:id`

### `GetTeamsQuery`

| Field       | Type            | Constraints                                   |
| ----------- | --------------- | --------------------------------------------- |
| `judging`   | `BooleanString` | Optional. Filters teams for judging view      |
| `season_id` | `number`        | Optional. Positive integer, filters by season |

**API endpoint:** `GET /api/teams` (query parameters)

### `SubmitTeamRequest`

| Field     | Type          | Constraints                            |
| --------- | ------------- | -------------------------------------- |
| `pathway` | `TeamPathway` | Required, `'junior'` or `'senior'`     |
| `project` | `object`      | Required, see project sub-schema below |

**Project sub-schema:**

| Field                 | Type                 | Constraints                   |
| --------------------- | -------------------- | ----------------------------- |
| `project.name`        | `ProjectName`        | Required, 1–100 characters    |
| `project.description` | `ProjectDescription` | Required, 30–2000 characters  |
| `project.demo_url`    | `RequiredProjectUrl` | Required, valid URL, max 2048 |
| `project.repo_url`    | `RequiredProjectUrl` | Required, valid URL, max 2048 |
| `project.sourcing`    | `string`             | Optional, max 2000 characters |

**API endpoint:** `POST /api/teams/:id/submit`

### `AddTeamMemberRequest`

| Field   | Type         | Constraints                       |
| ------- | ------------ | --------------------------------- |
| `email` | `BasisEmail` | Must be a `@basischina.com` email |

**API endpoint:** `POST /api/teams/:id/users`

---

## User Schema

### `UpdateUserRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `name` | `string` | Optional, max 30 characters |
| `profile_theme_image` | `File \| string \| null` | Optional. File must be ≤ 7 MiB and JPEG/JPG/PNG/GIF/WebP. String must be a valid base64 data URL for one of those types. `null` clears the image. |
| `avatar` | `File \| string \| null` | Optional. Same constraints as `profile_theme_image`. |

**Image validation details:**

- Maximum decoded profile image size: 7 MiB (`7 * 1024 * 1024` bytes); its base64 JSON body stays below Nitro's 10 MiB request limit.
- Accepted MIME types: `image/jpeg`, `image/jpg`, `image/png`, `image/gif`, `image/webp`
- Data URIs are accepted (string starting with `'data'`)
- Error messages use the `formatBytes()` helper exported from `shared/schemas.ts`:
    ```ts
    formatBytes(7 * 1024 * 1024); // → "7 MB"
    ```

**`formatBytes(bytes, decimals = 2)`:** Converts byte counts to human-readable strings (Bytes, KB, MB, GB, etc.).

**API endpoint:** `PATCH /api/users/:id`

---

## Scoring & Voting Schemas

### `CreateTeamScoresRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `reasoning` | `string` | 10–2000 characters |
| `scores` | `ScoreValues` | Object with the active rubric criteria keys and configured integer ranges |

**API endpoint:** `POST /api/teams/:id/scores`

### `SubmitVoteRequest`

| Field       | Type       | Constraints                                 |
| ----------- | ---------- | ------------------------------------------- |
| `scores`    | `number[]` | Array of integers, each 0–5, max 50 entries |
| `reasoning` | `string`   | Max 2000 characters                         |

**Refinement:** `.refine(({ scores }) => scores.reduce((a, b) => a + b, 0) === 10)` — the scores **must sum to exactly 10**. This is enforced by a Zod `.refine()` on the object, not individually on the array.

**API endpoint:** `POST /api/ballot`

---

## Retained Legacy OAuth2 Schemas

These exported schemas remain for rollback and source compatibility. The native provider and `/api/applications/*` routes have been retired; new client registration belongs in basis-auth.

### `DeleteApplicationsRequest`

| Field | Type       | Constraints                                            |
| ----- | ---------- | ------------------------------------------------------ |
| `ids` | `string[]` | Required, 1–100 non-empty client IDs to delete at once |

### `ManageRedirectUriRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `uri` | `string` | Required. Must start with `https://` or match `http://localhost(/:\|$)` pattern |

The refinement uses a custom function: `(u) => u.startsWith("https://") || /^http:\/\/localhost(\/|:|$)/.test(u)`. This allows any `https://` URL or `http://localhost` with any port or path.

---

## OAuth2 Token & Session Schemas

### `OAuth2TokenRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `grant_type` | `'authorization_code'` | Literal `authorization_code`, only grant type supported |
| `code` | `string` | Required, 1–1024 characters |
| `client_id` | `string` | Required, 1–256 characters |
| `client_secret` | `string` | Required, 1–512 characters |
| `redirect_uri` | `string` | Optional, max 2048 characters, or empty string |
| `code_verifier` | `string` | Optional, max 128 characters, used for PKCE |

### `OAuth2SessionActionRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `action` | `'cancel' \| 'consent' \| 'assume_consent' \| 'deny'` | Required, must be one of the four actions |

---

## Election Schema

### `ElectionVoteRequest`

| Field | Type | Constraints |
| --- | --- | --- |
| `positions` | `array` | Max 20 entries, one per election position |
| `positions[].title` | `string` | Max 128 characters, must match a known position |
| `positions[].candidates` | `array` | Max 50 candidates per position |
| `positions[].candidates[].id` | `string` | Max 64 characters |
| `positions[].candidates[].rank` | `number \| null` | Integer 1+, or `null` to abstain |

A `null` rank records an abstention for that candidate. The schema does not enforce uniqueness or contiguity of ranks; application logic handles IRV tabulation rules.

**API endpoint:** `POST /api/election/vote`

---

## Season Schema

### `SetActiveSeasonRequest`

| Field       | Type             | Constraints                           |
| ----------- | ---------------- | ------------------------------------- |
| `season_id` | `number \| null` | Integer, positive, or `null` to unset |

**API endpoint:** `PATCH /api/seasons/active`

### `UpdateSeasonTweaksRequest`

All fields are optional, but at least one must be provided. Only these three settings are tweakable; any other fields in the request body are stripped.

| Field          | Type      | Constraints                                                         |
| -------------- | --------- | ------------------------------------------------------------------- |
| `status`       | `string`  | One of `not_started`, `in_progress`, `voting`, `finished`, `paused` |
| `show_scores`  | `boolean` | Show scores to participants in results                              |
| `show_ranking` | `boolean` | Show rankings to participants in results                            |

**API endpoint:** `PATCH /api/seasons/:id/tweaks`
