---
title: Voting
description: How peer voting works in nethack.
---

# Voting

nethack uses a single peer voting system. Participants distribute stars across hackathon projects during the `voting` phase. There is no separate election voting system in the current codebase.

## Peer Voting

Peer voting opens when the dev-portal `voting_enabled` toggle is on, the event is not `paused`, and the configured `voting_end_timestamp` has not passed while `ENFORCE_DEADLINES` is on. Only participants with a submitted project can vote, and they can only vote on eligible projects in the **same pathway** (`junior` or `senior`).

### Eligibility Rules

| Requirement                           | Reason                           |
| ------------------------------------- | -------------------------------- |
| User is authenticated                 | `requireUser(event)`             |
| User belongs to a team                | `user.team_id` must be set       |
| User's team has submitted a project   | `team.project_submitted = 1`     |
| Target project is submitted           | Fetched via `getSubmittedTeams`  |
| Target project is in the same pathway | `p.pathway === userTeam.pathway` |
| User cannot vote for their own team   | `p.id !== user.team_id`          |

### The 10-Star Rule

Each voter has **exactly 10 stars** to distribute among eligible projects. A single project can receive **0–5 stars**. The `SubmitVoteRequest` Zod schema enforces:

```ts
scores.reduce((a, b) => a + b, 0) === 10;
```

::: warning If the total is not exactly 10, the server rejects the ballot with a validation error. :::

If `max_votes_per_user` is greater than `0`, at most that many projects may receive a non-zero score; the default `0` means unlimited. The portal control therefore caps how widely a voter can spread their stars, not the ten-star total.

### Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  /voting    │     │  /api/ballot │     │  peer_voting_scores │
│   page      │────►│   (GET/POST) │────►│      table          │
└─────────────┘     └──────────────┘     └─────────────────────┘
```

1. The frontend fetches the ballot from `GET /api/ballot`.
2. The server returns eligible projects, any previously saved scores, and optional reasoning.
3. The user adjusts scores with increment/decrement buttons.
4. On submit, `POST /api/ballot` validates the request and upserts a row in `peer_voting_scores` via `server/utils/database/peer-voting.ts`. A participant may replace their ballot until voting closes; the page keeps the controls editable and labels the action **Update vote**. The row is keyed by `(user_id, season_id)`, so a returning participant's earlier ballot is preserved.

### People's Choice

After voting closes, `GET /api/ballot/results` aggregates the ballots:

1. Each voting team's ballots are averaged into one unit per project.
2. Those unit values are averaged across every team that voted.
3. `team_units` counts the teams that gave the project a non-zero score.

This prevents one large team from multiplying its influence by having every member vote. The response also reports turnout as submitted projects, voting teams, ballots, and a turnout ratio. Public callers need the gallery gate open and results published for the active season; judging staff may read before publication. The `/results` page shows the top project as People's Choice.

### Ballot Response

`GET /api/ballot` returns a `GetBallotResponse`:

| Field       | Type             | Description                                        |
| ----------- | ---------------- | -------------------------------------------------- |
| `submitted` | `boolean`        | Whether the user has already voted                 |
| `projects`  | `APITeam[]`      | Eligible projects to vote on                       |
| `scores`    | `number[]`       | Current star distribution (parallel to `projects`) |
| `reasoning` | `string \| null` | Optional voter reasoning                           |

### UI

The `/voting` page renders `VotingProjectCard` components for each eligible project. The summary panel shows:

- Total stars used (`{{ totalStars }} / 10`)
- Per-project distribution
- A reasoning textarea
- A submit button that is disabled until the total equals 10

### API Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/ballot` | Authenticated participant with a submitted project | Get the current peer voting ballot |
| POST | `/api/ballot` | Authenticated participant with a submitted project | Submit or update a peer vote |
| GET | `/api/ballot/summary` | Authenticated user | Per-season judging progress summary |

### Source Files

- `server/api/ballot/index.get.ts`
- `server/api/ballot/index.post.ts`
- `server/api/ballot/summary.get.ts`
- `server/utils/database/peer-voting.ts`
- `app/pages/voting.vue`
- `app/components/VotingProjectCard.vue`
