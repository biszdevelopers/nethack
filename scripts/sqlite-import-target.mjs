import { DEFAULT_RUBRIC_DEFINITION } from "../shared/rubric.ts";

export const IMPORT_TARGET_TABLES = [
    "hackathon",
    "seasons",
    "teams",
    "users",
    "rubric_templates",
    "rubric_versions",
    "judging_drafts",
    "team_scores",
    "ballots",
    "ballot_scores",
    "oauth2_applications",
    "awards",
    "team_awards",
    "peer_voting_scores",
    "user_past_teams",
    "sc_votes",
    "sqlite_legacy_data",
];

export const PRISTINE_HACKATHON_SEED = {
    id: 1,
    status: "not_started",
    voting_enabled: 0,
    results_published: 0,
    show_scores: 0,
    show_ranking: 0,
    submitted_count: 0,
    max_votes_per_user: 0,
    judging_open: 0,
    schedule_start: null,
    schedule_end: null,
    start_timestamp: 0,
    end_timestamp: 0,
    voting_start_timestamp: 0,
    voting_end_timestamp: 0,
    results_open_timestamp: 0,
    theme_name: null,
    theme_description: null,
};

const PRISTINE_SEASON_SEED = {
    id: 1,
    name: "Season 1",
    is_active: 1,
    status: "not_started",
    voting_enabled: 0,
    results_published: 0,
    judging_open: 0,
    show_scores: 0,
    show_ranking: 0,
    max_votes_per_user: 0,
    schedule_start: null,
    schedule_end: null,
    start_timestamp: 0,
    end_timestamp: 0,
    voting_start_timestamp: 0,
    voting_end_timestamp: 0,
    results_open_timestamp: 0,
    theme_name: null,
    theme_description: null,
    score_curve_preset: "original",
};

const PRISTINE_TEMPLATE_NAME = "BIBS-C Default";
const PRISTINE_TEMPLATE_DESCRIPTION = "The original BIBS-C judging rubric.";

function matchesFields(row, expected) {
    return Boolean(row) && Object.entries(expected).every(([key, value]) => row[key] === value);
}

function stableJson(value) {
    if (Array.isArray(value)) return value.map(stableJson);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, stableJson(value[key])]),
    );
}

function matchesJson(left, right) {
    return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function countOf(counts, tableName) {
    return Number(counts[tableName] ?? 0);
}

/**
 * Recognize only an otherwise-empty PostgreSQL target or the exact seed state
 * created by `bun run db:migrate` / first application startup. The returned
 * IDs are deleted by the importer inside its existing transaction.
 */
export function inspectFreshImportTarget({ counts, rows }) {
    const hackathonCount = countOf(counts, "hackathon");
    const rubricSeedTables = ["seasons", "rubric_templates", "rubric_versions"];
    const hasAnyRows = Object.values(counts).some((count) => Number(count ?? 0) > 0);
    if (!hasAnyRows) return { hackathonId: undefined, rubricSeed: undefined };

    // Fresh `db:migrate` creates the complete set together. A partial seed set
    // could be the remnant of an interrupted/manual setup and must not be
    // cleared as though it were a pristine database.
    if (
        hackathonCount !== 1 ||
        rubricSeedTables.some((tableName) => countOf(counts, tableName) !== 1) ||
        !matchesFields(rows.hackathon, PRISTINE_HACKATHON_SEED)
    ) {
        return null;
    }

    const season = rows.seasons;
    const template = rows.rubric_templates;
    const version = rows.rubric_versions;
    if (
        !matchesFields(season, {
            ...PRISTINE_SEASON_SEED,
            rubric_version_id: version?.id,
        }) ||
        !matchesFields(template, {
            id: 1,
            name: PRISTINE_TEMPLATE_NAME,
            description: PRISTINE_TEMPLATE_DESCRIPTION,
            created_by: null,
        }) ||
        !matchesJson(template?.definition, DEFAULT_RUBRIC_DEFINITION) ||
        !matchesFields(version, {
            id: 1,
            season_id: season?.id,
            version: 1,
            name: PRISTINE_TEMPLATE_NAME,
            source_template_id: template?.id,
            created_by: null,
        }) ||
        !matchesJson(version?.definition, DEFAULT_RUBRIC_DEFINITION)
    ) {
        return null;
    }

    const allowedSeedCounts = new Set(["hackathon", ...rubricSeedTables]);
    for (const [tableName, count] of Object.entries(counts)) {
        if (Number(count ?? 0) > 0 && !allowedSeedCounts.has(tableName)) {
            return null;
        }
    }

    return {
        hackathonId: rows.hackathon.id,
        rubricSeed: {
            seasonId: season.id,
            templateId: template.id,
            rubricVersionId: version.id,
        },
    };
}

/** Delete only the seed rows returned by inspectFreshImportTarget. */
export async function clearFreshImportTargetSeeds(sql, seedPlan) {
    if (!seedPlan || typeof seedPlan !== "object") {
        throw new TypeError("A verified fresh import target seed plan is required.");
    }

    if (seedPlan.rubricSeed) {
        await sql`DELETE FROM rubric_versions WHERE id = ${seedPlan.rubricSeed.rubricVersionId}`;
        await sql`DELETE FROM seasons WHERE id = ${seedPlan.rubricSeed.seasonId}`;
        await sql`DELETE FROM rubric_templates WHERE id = ${seedPlan.rubricSeed.templateId}`;
    }
    if (seedPlan.hackathonId !== undefined) {
        await sql`DELETE FROM hackathon WHERE id = ${seedPlan.hackathonId}`;
    }
}
