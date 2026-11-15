---
title: Judging Rubric
description: Rubric criteria, weightings, and scoring system for judge evaluation
---

# Judging Rubric

Each season uses an immutable version of its judging rubric. Organizers can create named reusable templates, copy a rubric from an earlier season, or define the current season's tracks and criteria directly. Each track supports 1–20 criteria with integer score ranges and weights totaling 100. The examples below describe the built-in default rubric used for a new installation and legacy imports.

::: info Source Files

- `shared/rubric.ts` — Rubric definitions
- `shared/score-curve.ts` — Score display curve presets
- `documentation/shared/seasons.md` — Season system :::

## Rubric Definition Shape

Organizers configure named tracks, criteria, integer minimum and maximum scores, and weights. Criterion weights total exactly 100 within each track. The active season stores an immutable rubric version; finalized scores retain the version ID used when they were submitted. Reusable templates can be copied between seasons.

For each judge, criterion scores are normalized from the configured integer range to 0–100, multiplied by their percentage weights, and combined into that judge's weighted result. The team's original result is the arithmetic mean of its judges' normalized weighted results. Ranking uses this original result, with ties receiving the same rank. Display curves are presentation-only and never alter saved evaluations or rankings.

The built-in rubric criterion shape is:

```ts
export interface RubricData {
    abbr: string; // Short abbreviation (e.g., 'ORG')
    name: string; // Full criterion name
    description: string; // One-line description
    weight: number; // Percentage weight (must sum to 100 per pathway)
}
```

`RubricData` remains the shape of the original built-in criteria. Configurable season rubrics use `RubricCriterion`, `RubricTrack`, and `RubricDefinition`:

```ts
interface RubricCriterion {
    id: string;
    name: string;
    description: string;
    weight: number;
    minScore: number;
    maxScore: number;
}

interface RubricTrack {
    name: string;
    criteria: RubricCriterion[];
}

interface RubricDefinition {
    tracks: Record<string, RubricTrack>;
    commentGuidance?: {
        introduction: string;
        guidelines: string[];
        templates: { label: string; body: string }[];
    };
}
```

## Junior Pathway

The junior pathway prioritizes **innovation and originality**, reflecting the expectation that younger participants should demonstrate creativity.

| Criterion | Abbr | Name | Weight | Description |
| --- | --- | --- | --- | --- |
| `originality` | ORG | Innovation & Originality | **30%** | Novelty of idea and approach. |
| `presentation` | PRE | Presentation & Design | **25%** | Clarity, polish, and design of demo. |
| `technicality` | TEC | Technical Complexity | **20%** | Depth and quality of technical implementation. |
| `theme` | THM | Theme Alignment | **15%** | How clearly the project relates to the theme. |
| `impact` | IMP | Impact & Usefulness | **10%** | Potential to solve real problems or benefit users. |

**Total: 100%**

## Senior Pathway

The senior pathway prioritizes **impact and usefulness**, reflecting the expectation that older participants should build practical solutions.

| Criterion | Abbr | Name | Weight | Description |
| --- | --- | --- | --- | --- |
| `impact` | IMP | Impact & Usefulness | **30%** | Potential to solve real problems or benefit users. |
| `presentation` | PRE | Presentation & Design | **25%** | Clarity, polish, and design of demo. |
| `technicality` | TEC | Technical Complexity | **20%** | Depth and quality of technical implementation. |
| `theme` | THM | Theme Alignment | **15%** | How clearly the project relates to the theme. |
| `originality` | ORG | Innovation & Originality | **10%** | Novelty of idea and approach. |

**Total: 100%**

## Score Range

<AnimatedCounter :target="5" suffix="max points" />

The built-in rubric uses a **0–5 integer scale**. Organizers may configure other integer ranges for a season:

| Score | Meaning                 |
| ----- | ----------------------- |
| 0     | Not evaluated / missing |
| 1     | Poor                    |
| 2     | Below average           |
| 3     | Average                 |
| 4     | Above average           |
| 5     | Excellent               |

Score validation uses each criterion's configured `minScore` and `maxScore`:

```ts
score >= criterion.minScore && score <= criterion.maxScore && Number.isInteger(score);
```

## Weighted Score Calculation

A judge's evaluation is calculated by normalizing each integer criterion score to its configured range, applying that criterion's weight, summing the weighted values, and rounding to a 0–100 score:

```
judgeScore = round(Σ ((criterionScore - minScore) / (maxScore - minScore) × weight))
```

The final team score is the arithmetic mean of its judges' normalized scores, rounded to an integer. Rankings are calculated from that uncurved mean within each track; teams with equal scores share a rank.

**Example (Junior pathway):**

| Criterion    | Score | Weight | Weighted        |
| ------------ | ----- | ------ | --------------- |
| originality  | 4     | 30%    | 4 × 0.30 = 1.20 |
| presentation | 5     | 25%    | 5 × 0.25 = 1.25 |
| technicality | 3     | 20%    | 3 × 0.20 = 0.60 |
| theme        | 4     | 15%    | 4 × 0.15 = 0.60 |
| impact       | 3     | 10%    | 3 × 0.10 = 0.30 |

```
rawSum = 1.20 + 1.25 + 0.60 + 0.60 + 0.30 = 3.95
finalScore = 3.95 × 20 = 79
```

For the built-in default rubric, each score range is 0–5, so the normalized weighted result is equivalent to the legacy formula above. Custom rubrics use the same normalization with their configured minimum and maximum integer values.

## Live rubric in HACKATHON.yml

Edit `rubric.tracks.<track-id>.criteria` in the live manifest. Each criterion specifies an `id`, `name`, `description`, percentage `weight`, `minScore`, and `maxScore`. Each track's weights must total 100. Set `rubric.name` for the version label and use `rubric.commentGuidance` for the introduction, guidelines, and templates.

When an active rubric is requested, the server validates the manifest and activates a matching immutable PostgreSQL snapshot. It creates a version if the name or definition has changed and no matching snapshot exists. Saved drafts and finalized evaluations retain their original version. A rubric cannot remove a track used by a submitted project. Manifests without a `rubric` section use the season's stored rubric, so deployed files can be updated independently. The TypeScript default still seeds fresh databases and maps legacy SQLite evaluations.

## Rubric Versions and Templates

Each season points to one active rubric version. Creating a new version snapshots its definition and makes it active for future evaluations; finalized evaluations keep their original `rubric_version_id`. Editing a reusable template does not change any version already used by a season. Organizers can copy a prior season's active version into a new version for the selected season.

The rubric editor validates unique criterion IDs, integer score limits, and weights totaling exactly 100 for every track. A track used by an already submitted project cannot be removed from the active season rubric until those projects are reassigned.

## Score Display Curves and Feedback

Each season can choose one score display curve. For a raw score `s` from 0 to 100, the displayed value is `round(100 × (s / 100) ^ exponent)`:

| Preset     | Exponent | Effect                            |
| ---------- | -------: | --------------------------------- |
| `original` |     1.00 | Keep the original score unchanged |
| `gentle`   |     0.90 | Apply a gentle uplift             |
| `moderate` |     0.80 | Apply a moderate uplift           |
| `strong`   |     0.65 | Apply a stronger uplift           |

The curve changes the score shown to participants, while saved judge evaluations, the arithmetic mean, and ranking stay unchanged. Participants see the score only after results are published, at least three judges have evaluated the team, and the season's `show_scores` setting is enabled. Rank requires the same publication and reviewer-count gates plus `show_ranking`.

Current and past team members can view anonymous judge comments only after results are published and at least three judges have evaluated the team. While comments are withheld, the public response includes a boolean status so the UI can explain the gate without returning an exact review count. Public feedback contains the comment text only: it omits judge names and IDs, rubric and track metadata, individual scores, and evaluation ordering signals. The overall score also requires `show_scores`, and rank requires `show_ranking`; both remain hidden until results are published and at least three evaluations exist. Authorized administrators can inspect full evaluations, including judge names and account IDs, before or after publication.

Each immutable rubric version also stores the judge-comment introduction, guidelines, and prompt templates. Organizers configure them in the season rubric editor when saving a new version. Copying a rubric from a prior season or a reusable template carries that version's settings forward; older definitions without settings resolve to the built-in defaults. The API validates nonempty text, maximum lengths and counts, and case-insensitive unique template labels.

Judges must write at least 20 characters of feedback before reviewing and finalizing an evaluation. The form offers editable prompts:

```text
Strength I observed: {{describe a specific feature or decision}}
Next step: {{suggest one concrete action and why it matters}}

What stood out: {{describe a specific moment, feature, or result}}
To make it stronger: {{suggest one practical improvement}}

Implementation strength: {{name a technical choice and its effect}}
Area to explore next: {{suggest a useful test or refinement}}
```

Replace every double-braced example with an observation about the project. Comments should be specific, respectful, actionable, and focused on the work. Avoid comments about a competitor's personal traits, background, or identity, and do not include identifying details about the judge. Competitor feedback omits judge names and account IDs; authorized administrators can see those identities in the admin view. As a limited safeguard, final submission rejects the judge's exact email address or display name in the comment; this check does not detect indirect clues, alternate spellings, or other identifying text.

## Seasons

Seasons are stored in the database `seasons` table rather than in source control. Each row carries its name, active state, and a full per-season copy of the hackathon configuration (`status`, `show_scores`, `show_ranking`, timestamps, theme, and so on).

The active season is tracked through the `is_active` column and can be set via `PATCH /api/seasons/active`. Score and rank visibility for results is driven per season by the `show_scores` / `show_ranking` columns through `getScoreRankVisibilityResolver` in `server/utils/database/seasons.ts`.

See [Seasons](../shared/seasons) for the full season model and API reference.

## Related Schemas

- `CreateTeamScoresRequest` — validates judge scoring input (reasoning + ScoreValues)
- `ScoreValues` — dynamically generated object schema from rubric criteria keys
- `SubmitVoteRequest` — validates peer voting (scores must sum to 10)
