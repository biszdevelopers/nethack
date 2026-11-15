import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "~~/server/database/schema";
import { getTeamScoreFeedback } from "~~/server/utils/score-feedback";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

describe("getTeamScoreFeedback", () => {
    it("keeps feedback available without returning judge identity", async () => {
        const criteria = DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria;
        const rowsByTable: Record<string, Record<string, unknown>[]> = {
            [getTableName(schema.seasons)]: [{ id: 1, score_curve_preset: "original" }],
            [getTableName(schema.teamScores)]: [
                {
                    team_id: 5,
                    rubric_version_id: 2,
                    scores: JSON.stringify(
                        Object.fromEntries(
                            criteria.map((criterion) => [criterion.id, criterion.maxScore]),
                        ),
                    ),
                    reasoning: "Useful anonymous feedback",
                    judge_user_id: 90210,
                },
            ],
            [getTableName(schema.rubricVersions)]: [
                {
                    id: 2,
                    name: "BIBS-C Default",
                    version: 1,
                    definition: DEFAULT_RUBRIC_DEFINITION,
                },
            ],
        };

        const db = {
            select: () => ({
                from: (table: unknown) => {
                    const rows = rowsByTable[getTableName(table as typeof schema.seasons)] ?? [];
                    const query = {
                        where: () => query,
                        limit: () => query,
                        then: (
                            resolve: (value: Record<string, unknown>[]) => unknown,
                            reject: (error: unknown) => unknown,
                        ) => Promise.resolve(rows).then(resolve, reject),
                    };
                    return query;
                },
            }),
        };

        const feedback = await getTeamScoreFeedback(
            { context: { drizzle: db } } as never,
            { id: 5, season_id: 1, pathway: "junior", score: 100, rank: 1 } as never,
        );

        expect(feedback.feedback).toHaveLength(1);
        expect(feedback.feedback[0]!.reasoning).toBe("Useful anonymous feedback");
        expect(JSON.stringify(feedback)).not.toContain("judge_user_id");
        expect(JSON.stringify(feedback)).not.toContain("90210");
    });
});
