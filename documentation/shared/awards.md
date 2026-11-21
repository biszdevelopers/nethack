---
title: Awards System
description: How team awards are defined, stored, and returned in API responses.
---

# Awards System

Team awards are a lightweight way to recognize special achievements (for example, a perfect judge score). Both award definitions and per-team assignments are stored in the database.

## Award Definition

The `awards` table describes an award:

```sql
CREATE TABLE awards (
    namespace TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'gold'
);
```

| Field         | Description                                  |
| ------------- | -------------------------------------------- |
| `namespace`   | Unique machine-readable identifier           |
| `name`        | Human-readable display name                  |
| `description` | Short explanation of how the award is earned |
| `icon`        | Iconify icon class                           |
| `color`       | Display color, defaulting to `gold`          |

## Catalog

The initial migration seeds the `perfect_score` award. Administrators manage the catalog through `/api/admin/awards` and assign awards to teams through `/api/admin/teams/:id/awards`; each mutation writes an audit row. A namespace still assigned to a team cannot be deleted (`409`).

## API Representation

Awards are returned as part of `APITeam` via the `APIAward` interface:

```ts
interface APIAward {
    namespace: string;
    name: string;
    description: string;
    icon: string;
    meta: Record<string, unknown>;
    color: string;
    text: string;
}
```

`APITeam.awards` is an array of `APIAward` objects. The `convertTeamToPublic` helper receives awards resolved by `server/utils/database/awards.ts`; `text` is the stored award description. Public team payloads include awards only after that team's season publishes results; judging staff and administrators bypass the gate.

## Database Helpers

`server/utils/database/awards.ts` provides the following Drizzle-backed functions:

| Function | Description |
| --- | --- |
| `getAwards(event, teamId)` | Select resolved awards for a single team from `team_awards` |
| `getAwardsForTeams(event, teamIds)` | Select resolved awards for multiple teams, grouped by team |
| `createAward(event, teamId, award, meta?)` | Insert a team award (`award` is an `awards.namespace`); `meta` is an optional JSON string defaulting to `{}` |
| `deleteTeamAwards(event, teamId)` | Delete all awards for a team |
| `deleteAward(event, teamId, award)` | Delete a specific award namespace for a team |

Award storage uses the `team_awards` table with columns `team_id`, `award` (the catalog namespace), and `meta` (a JSON string). The `meta` column is non-null and defaults to `{}` at insert time. Metadata is parsed and the catalog details are resolved through an inner join with `awards`.

## Source Files

- `server/database/schema.ts` — award catalog and assignment schema
- `shared/responses.d.ts` — `APIAward` interface
- `server/utils/database/awards.ts` — database helpers
- `server/utils/convert.ts` — resolves awards when converting teams
