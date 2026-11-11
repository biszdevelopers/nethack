import { describe, expect, it } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION } from "../../shared/rubric";
import {
    clearFreshImportTargetSeeds,
    IMPORT_TARGET_TABLES,
    inspectFreshImportTarget,
} from "../../scripts/sqlite-import-target.mjs";

const freshSeed = () => {
    const counts = Object.fromEntries(IMPORT_TARGET_TABLES.map((table) => [table, 0]));
    Object.assign(counts, {
        hackathon: 1,
        seasons: 1,
        rubric_templates: 1,
        rubric_versions: 1,
    });

    return {
        counts,
        rows: {
            hackathon: {
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
            },
            seasons: {
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
                rubric_version_id: 1,
            },
            rubric_templates: {
                id: 1,
                name: "BIBS-C Default",
                description: "The original BIBS-C judging rubric.",
                definition: DEFAULT_RUBRIC_DEFINITION,
                created_by: null,
            },
            rubric_versions: {
                id: 1,
                season_id: 1,
                version: 1,
                name: "BIBS-C Default",
                definition: DEFAULT_RUBRIC_DEFINITION,
                source_template_id: 1,
                created_by: null,
            },
        },
    };
};

describe("SQLite import PostgreSQL target seed checks", () => {
    it("accepts and plans to clear the complete seed from a fresh db:migrate", () => {
        const target = freshSeed();

        expect(inspectFreshImportTarget(target)).toEqual({
            hackathonId: 1,
            rubricSeed: { seasonId: 1, templateId: 1, rubricVersionId: 1 },
        });
    });

    it("accepts a completely empty PostgreSQL target", () => {
        const counts = Object.fromEntries(IMPORT_TARGET_TABLES.map((table) => [table, 0]));
        expect(inspectFreshImportTarget({ counts, rows: {} })).toEqual({
            hackathonId: undefined,
            rubricSeed: undefined,
        });
    });

    it("clears only the verified seed rows in foreign-key-safe order", async () => {
        const statements: Array<{ sql: string; values: unknown[] }> = [];
        const sql = (parts: TemplateStringsArray, ...values: unknown[]) => {
            statements.push({ sql: parts.join("?").replaceAll("?", "$value"), values });
            return Promise.resolve();
        };

        await clearFreshImportTargetSeeds(sql, {
            hackathonId: 1,
            rubricSeed: { seasonId: 1, templateId: 1, rubricVersionId: 1 },
        });

        expect(statements.map(({ sql: statement, values }) => [statement, values])).toEqual([
            ["DELETE FROM rubric_versions WHERE id = $value", [1]],
            ["DELETE FROM seasons WHERE id = $value", [1]],
            ["DELETE FROM rubric_templates WHERE id = $value", [1]],
            ["DELETE FROM hackathon WHERE id = $value", [1]],
        ]);
    });

    it("rejects every populated application table outside the exact fresh seed", () => {
        for (const table of IMPORT_TARGET_TABLES) {
            if (["hackathon", "seasons", "rubric_templates", "rubric_versions"].includes(table)) {
                continue;
            }

            const target = freshSeed();
            target.counts[table] = 1;
            expect(inspectFreshImportTarget(target), table).toBeNull();
        }
    });

    it("rejects partial, modified, or extra seed rows", () => {
        const modifiedSeason = freshSeed();
        modifiedSeason.rows.seasons.status = "in_progress";
        expect(inspectFreshImportTarget(modifiedSeason)).toBeNull();

        const partialSeed = freshSeed();
        partialSeed.counts.rubric_templates = 0;
        expect(inspectFreshImportTarget(partialSeed)).toBeNull();

        const extraSeason = freshSeed();
        extraSeason.counts.seasons = 2;
        expect(inspectFreshImportTarget(extraSeason)).toBeNull();

        const modifiedRubric = freshSeed();
        modifiedRubric.rows.rubric_versions.definition = { tracks: {} };
        expect(inspectFreshImportTarget(modifiedRubric)).toBeNull();
    });
});
