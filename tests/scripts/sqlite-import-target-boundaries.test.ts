import { describe, expect, it, vi } from "vitest";
import {
    clearFreshImportTargetSeeds,
    IMPORT_TARGET_TABLES,
    inspectFreshImportTarget,
} from "../../scripts/sqlite-import-target.mjs";
import { DEFAULT_RUBRIC_DEFINITION } from "../../shared/rubric";

const freshSeedTarget = () => {
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

describe("SQLite import target validation boundaries", () => {
    it("accepts bigint values for PostgreSQL safe-integer seed columns", () => {
        const target = freshSeedTarget();
        target.rows.hackathon.start_timestamp = 0n;
        target.rows.seasons.end_timestamp = 0n;

        expect(inspectFreshImportTarget(target)).toMatchObject({
            hackathonId: 1,
            rubricSeed: { seasonId: 1, templateId: 1, rubricVersionId: 1 },
        });

        target.rows.hackathon.start_timestamp = 1n;
        expect(inspectFreshImportTarget(target)).toBeNull();
    });

    it("treats absent and undefined count values as zero", () => {
        const sparseTarget = freshSeedTarget();
        delete sparseTarget.counts.seasons;
        expect(inspectFreshImportTarget(sparseTarget)).toBeNull();

        const emptyCounts = { notReturnedByDatabase: undefined };
        expect(inspectFreshImportTarget({ counts: emptyCounts, rows: {} })).toEqual({
            hackathonId: undefined,
            rubricSeed: undefined,
        });

        const otherwiseFresh = freshSeedTarget();
        otherwiseFresh.counts.unknownTable = undefined;
        expect(inspectFreshImportTarget(otherwiseFresh)).toMatchObject({ hackathonId: 1 });
    });

    it("rejects missing seed rows and invalid bigint-shaped strings", () => {
        const missingHackathon = freshSeedTarget();
        missingHackathon.rows.hackathon = undefined;
        expect(inspectFreshImportTarget(missingHackathon)).toBeNull();

        const malformedNumericString = freshSeedTarget();
        malformedNumericString.rows.seasons.start_timestamp = "01";
        expect(inspectFreshImportTarget(malformedNumericString)).toBeNull();
    });

    it("rejects invalid clear plans and safely clears partial plans", async () => {
        const sql = vi.fn(async () => undefined);

        await expect(clearFreshImportTargetSeeds(sql, undefined)).rejects.toThrow(
            "A verified fresh import target seed plan is required.",
        );
        await expect(clearFreshImportTargetSeeds(sql, null)).rejects.toThrow(
            "A verified fresh import target seed plan is required.",
        );

        await clearFreshImportTargetSeeds(sql, {});
        expect(sql).not.toHaveBeenCalled();

        await clearFreshImportTargetSeeds(sql, { hackathonId: 1 });
        expect(sql).toHaveBeenCalledOnce();
        expect(String(sql.mock.calls[0]?.[0])).toContain("DELETE FROM hackathon");
    });

    it("clears rubric seed rows without deleting hackathon when no hackathon seed is planned", async () => {
        const statements: string[] = [];
        const sql = async (parts: TemplateStringsArray) => {
            statements.push(parts.join("?"));
        };

        await clearFreshImportTargetSeeds(sql, {
            rubricSeed: { seasonId: 5, templateId: 6, rubricVersionId: 7 },
        });

        expect(statements).toHaveLength(4);
        expect(statements.at(-1)).toContain("DELETE FROM rubric_templates");
        expect(statements.some((statement) => statement.includes("DELETE FROM hackathon"))).toBe(
            false,
        );
    });

    it("keeps the recognized target table list stable for import validation callers", () => {
        expect(IMPORT_TARGET_TABLES).toContain("sqlite_legacy_data");
        expect(IMPORT_TARGET_TABLES).toContain("team_scores");
    });
});
