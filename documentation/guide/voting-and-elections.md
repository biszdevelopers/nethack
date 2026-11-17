---
title: Voting
description: How peer voting works in nethack.
---

# Voting

nethack uses a single peer voting system. Participants distribute stars across hackathon projects during the `voting` phase. There is no separate election voting system in the current codebase.

## Peer Voting

Peer voting opens when the global `hackathon.status` is set to `voting`. Only participants with a submitted project can vote, and they can only vote on eligible projects in the **same pathway** (`junior` or `senior`).

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
4. On submit, `POST /api/ballot` validates the request and upserts a row in `peer_voting_scores` via `server/utils/database/peer-voting.ts`.

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
