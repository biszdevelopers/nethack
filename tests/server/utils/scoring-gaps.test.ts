import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createMockEvent } from "./database/helpers";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { rubricVersions, teams } from "~~/server/database/schema";
import {
    calculateSeasonScores,
    calculateSeasonScoresWithDatabase,
    getRubricVersionsByIds,
    recalculateTeamScoreAfterSubmission,
} from "~~/server/utils/scoring";

const seasonId = 71;

describe("scoring edge coverage", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: any;
    let rubricVersionId: number;
    let nextName: number;

    beforeEach(async () => {
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        nextName = 1;
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(?, ?, 1)").run(
            seasonId,
            "Edge season",
        );
        rubricVersionId = insertVersion(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?").run(
            rubricVersionId,
            seasonId,
        );
        raw.prepare("INSERT INTO users(email, role) VALUES('judge@test.invalid', 'judge')").run();
    });

    function insertVersion(definition: string, version = 1, season = seasonId) {
        return Number(
            raw
                .prepare(
                    "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(?, ?, 'Edge', ?)",
                )
                .run(season, version, definition).lastInsertRowid,
        );
    }

    function addTeam(pathway: string | null, submittedAt: string | null = null) {
        return Number(
            raw
                .prepare(
                    "INSERT INTO teams(name, pathway, season_id, project_submitted, submitted_at) VALUES(?, ?, ?, 1, ?)",
                )
                .run(`Team ${nextName++}`, pathway, seasonId, submittedAt).lastInsertRowid,
        );
    }

    function scoreObject(value: number) {
        return JSON.stringify(
            Object.fromEntries(
                DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                    criterion.id,
                    value,
                ]),
            ),
        );
    }

    function addScore(teamId: number, values: string, judge = 1) {
        raw.prepare(
            "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(?, ?, ?, '', ?, ?)",
        ).run(teamId, judge, values, seasonId, rubricVersionId);
    }

    it("returns an empty map for an empty id list", async () => {
        await expect(getRubricVersionsByIds(event.context.drizzle as any, [])).resolves.toEqual(
            new Map(),
        );
    });

    it("evicts the oldest cached rubric version beyond the bounded store", async () => {
        const ids: number[] = [rubricVersionId];
        for (let index = 0; index < 100; index += 1) {
            ids.push(insertVersion(JSON.stringify(DEFAULT_RUBRIC_DEFINITION), index + 2));
        }

        const resolved = await getRubricVersionsByIds(event.context.drizzle as any, ids);
        expect(resolved.size).toBe(101);

        raw.prepare("DELETE FROM rubric_versions WHERE id = ?").run(ids[0]);
        raw.prepare("DELETE FROM rubric_versions WHERE id = ?").run(ids[100]);

        const refreshed = await getRubricVersionsByIds(event.context.drizzle as any, [
            ids[0],
            ids[100],
            ids[99],
        ]);
        expect(refreshed.has(ids[0])).toBe(false);
        expect(refreshed.get(ids[100])?.id).toBe(ids[100]);
        expect(refreshed.get(ids[99])?.id).toBe(ids[99]);
    });

    it("treats a rubric track without criteria as a zero-score tie", async () => {
        const emptyVersion = insertVersion(
            JSON.stringify({ tracks: { junior: { name: "Junior", criteria: [] } } }),
            2,
        );
        raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?").run(
            emptyVersion,
            seasonId,
        );
        const teamId = addTeam("junior");
        raw.prepare(
            "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(?, 1, '{}', '', ?, ?)",
        ).run(teamId, seasonId, emptyVersion);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked).toMatchObject([{ id: teamId, score: 0, score_exact: 0, rank: 1 }]);
    });

    it("breaks exact-score ties by submission time in both directions", async () => {
        const nullTime = addTeam("junior", null);
        const timed = addTeam("junior", "2026-01-01T00:00:00.000Z");
        const timedSenior = addTeam("senior", "2026-01-01T00:00:00.000Z");
        const nullSenior = addTeam("senior", null);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map((team) => team.id)).toEqual([timed, nullTime, timedSenior, nullSenior]);
        expect(ranked.map((team) => team.rank)).toEqual([1, 2, 1, 2]);
    });

    it("breaks exact-score ties when one side has no tiebreak criterion", async () => {
        const unscoredJunior = addTeam("junior");
        const scoredJunior = addTeam("junior");
        addScore(scoredJunior, scoreObject(0));
        const scoredSenior = addTeam("senior");
        addScore(scoredSenior, scoreObject(0));
        const unscoredSenior = addTeam("senior");

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map((team) => team.id)).toEqual([
            scoredJunior,
            unscoredJunior,
            scoredSenior,
            unscoredSenior,
        ]);
        expect(ranked.map((team) => team.rank)).toEqual([1, 2, 1, 2]);
    });

    it("recalculates a named track and persists only changed rows", async () => {
        const senior = addTeam("senior");
        const target = event.context.drizzle
            .select()
            .from(teams)
            .where(eq(teams.id, senior))
            .get() as typeof teams.$inferSelect;
        const version = event.context.drizzle
            .select()
            .from(rubricVersions)
            .where(eq(rubricVersions.id, rubricVersionId))
            .get() as typeof rubricVersions.$inferSelect;

        await recalculateTeamScoreAfterSubmission(
            event.context.drizzle as any,
            seasonId,
            target,
            version,
        );

        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(senior)).toEqual({
            score: 0,
            rank: 1,
        });
    });

    it("skips scores for teams outside the recalculated track and accepts numeric timestamps", async () => {
        const trackTeam = {
            id: 1,
            pathway: "junior",
            status: "active",
            score: null,
            score_exact: null,
            rank: null,
            submitted_at: 1_700_000_000_000,
        };
        const updateWhere = vi.fn().mockResolvedValue(undefined);
        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(
                            table === teams
                                ? [trackTeam]
                                : table === rubricVersions
                                  ? []
                                  : [
                                        {
                                            team_id: 999,
                                            judge_user_id: 1,
                                            season_id: seasonId,
                                            rubric_version_id: rubricVersionId,
                                            scores: "{}",
                                            reasoning: "",
                                        },
                                    ],
                        ),
                }),
            }),
            update: () => ({
                set: () => ({
                    from: () => ({ where: updateWhere }),
                }),
            }),
        };

        await recalculateTeamScoreAfterSubmission(
            db as any,
            seasonId,
            { id: 1, pathway: "junior" } as typeof teams.$inferSelect,
            { id: rubricVersionId } as typeof rubricVersions.$inferSelect,
        );

        expect(updateWhere).toHaveBeenCalled();
    });

    it("rejects a recalculation whose saved score lost its rubric version", async () => {
        const trackTeam = {
            id: 1,
            pathway: "junior",
            status: "active",
            score: null,
            score_exact: null,
            rank: null,
            submitted_at: null,
        };
        const dbWithTeams = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(
                            table === teams
                                ? [trackTeam]
                                : table === rubricVersions
                                  ? []
                                  : [
                                        {
                                            team_id: 1,
                                            judge_user_id: 1,
                                            season_id: seasonId,
                                            rubric_version_id: 999,
                                            scores: "{}",
                                            reasoning: "",
                                        },
                                    ],
                        ),
                }),
            }),
            update: () => ({ set: () => ({ from: () => ({ where: vi.fn() }) }) }),
        };

        await expect(
            recalculateTeamScoreAfterSubmission(
                dbWithTeams as any,
                seasonId,
                trackTeam as unknown as typeof teams.$inferSelect,
                { id: rubricVersionId } as typeof rubricVersions.$inferSelect,
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("aggregates multiple saved evaluations for one track team", async () => {
        const trackTeam = {
            id: 1,
            pathway: "junior",
            status: "active",
            score: null,
            score_exact: null,
            rank: null,
            submitted_at: null,
        };
        const score = JSON.stringify(
            Object.fromEntries(
                DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                    criterion.id,
                    5,
                ]),
            ),
        );
        const updateWhere = vi.fn().mockResolvedValue(undefined);
        const version = {
            id: rubricVersionId,
            season_id: seasonId,
            version: 1,
            name: "Edge",
            definition: DEFAULT_RUBRIC_DEFINITION,
            source_template_id: null,
            created_by: null,
            created_at: new Date(),
        };
        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(
                            table === teams
                                ? [trackTeam]
                                : table === rubricVersions
                                  ? [version]
                                  : [
                                        {
                                            team_id: 1,
                                            judge_user_id: 1,
                                            season_id: seasonId,
                                            rubric_version_id: rubricVersionId,
                                            scores: score,
                                            reasoning: "",
                                        },
                                        {
                                            team_id: 1,
                                            judge_user_id: 2,
                                            season_id: seasonId,
                                            rubric_version_id: rubricVersionId,
                                            scores: score,
                                            reasoning: "",
                                        },
                                    ],
                        ),
                }),
            }),
            update: () => ({
                set: () => ({
                    from: () => ({ where: updateWhere }),
                }),
            }),
        };

        await recalculateTeamScoreAfterSubmission(
            db as any,
            seasonId,
            trackTeam as unknown as typeof teams.$inferSelect,
            version as any,
        );

        expect(updateWhere).toHaveBeenCalledOnce();
    });

    it("treats an unparseable submission timestamp as missing", async () => {
        const teamId = addTeam("junior");
        raw.prepare("UPDATE teams SET submitted_at = 'not-a-date' WHERE id = ?").run(teamId);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked).toMatchObject([{ id: teamId, rank: 1 }]);
    });

    it("sorts non-active teams with no rank in a stable order", async () => {
        const first = addTeam("junior");
        const second = addTeam("junior");
        raw.prepare("UPDATE teams SET status = 'withdrawn' WHERE id IN (?, ?)").run(first, second);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map(({ id, rank }) => ({ id, rank }))).toEqual([
            { id: first, rank: null },
            { id: second, rank: null },
        ]);
    });

    it("repairs every kind of changed ranking row", async () => {
        const score = JSON.stringify(
            Object.fromEntries(
                DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                    criterion.id,
                    5,
                ]),
            ),
        );
        const version = {
            id: rubricVersionId,
            season_id: seasonId,
            version: 1,
            name: "Edge",
            definition: DEFAULT_RUBRIC_DEFINITION,
            source_template_id: null,
            created_by: null,
            created_at: new Date(),
        };
        const previousRows = [
            { id: 1, score: 0, score_exact: 0, rank: 1 },
            { id: 2, score: 100, score_exact: null, rank: 2 },
            { id: 3, score: 100, score_exact: 100, rank: 1 },
            { id: 4, score: 100, score_exact: null, rank: 1 },
        ].map((row) => ({
            ...row,
            pathway: "junior",
            status: "active",
            submitted_at: null,
        }));
        const scoreRows = previousRows.map((row, index) => ({
            team_id: row.id,
            judge_user_id: index + 1,
            season_id: seasonId,
            rubric_version_id: rubricVersionId,
            scores: score,
            reasoning: "",
        }));
        const updateWhere = vi.fn().mockResolvedValue(undefined);
        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(
                            table === teams
                                ? previousRows
                                : table === rubricVersions
                                  ? [version]
                                  : scoreRows,
                        ),
                }),
            }),
            update: () => ({
                set: () => ({
                    from: () => ({ where: updateWhere }),
                }),
            }),
        };

        await recalculateTeamScoreAfterSubmission(
            db as any,
            seasonId,
            previousRows[0] as unknown as typeof teams.$inferSelect,
            version as any,
        );

        expect(updateWhere).toHaveBeenCalledOnce();
    });

    it("recalculates an empty track without loading scores", async () => {
        const updateWhere = vi.fn().mockResolvedValue(undefined);
        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(table === teams ? [] : table === rubricVersions ? [] : []),
                }),
            }),
            update: () => ({
                set: () => ({
                    from: () => ({ where: updateWhere }),
                }),
            }),
        };

        await recalculateTeamScoreAfterSubmission(
            db as any,
            seasonId,
            { id: 1, pathway: "junior" } as typeof teams.$inferSelect,
            { id: rubricVersionId } as typeof rubricVersions.$inferSelect,
        );

        expect(updateWhere).not.toHaveBeenCalled();
    });

    it("computes scores without persisting when persistence is disabled", async () => {
        const teamId = addTeam("junior");

        await expect(calculateSeasonScores(event as any, seasonId)).resolves.toMatchObject([
            { id: teamId, score: 0 },
        ]);
        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(teamId)).toEqual({
            score: null,
            rank: null,
        });
    });

    it("keeps the rubric cache when no oldest key can be evicted", async () => {
        const ids: number[] = [rubricVersionId];
        for (let index = 0; index < 100; index += 1) {
            ids.push(insertVersion(JSON.stringify(DEFAULT_RUBRIC_DEFINITION), index + 2));
        }
        const originalKeys = Map.prototype.keys;
        let skipped = false;
        Map.prototype.keys = function (this: Map<unknown, unknown>) {
            if (!skipped && this.size > 100) {
                skipped = true;
                return [][Symbol.iterator]() as MapIterator<unknown>;
            }
            return originalKeys.call(this);
        };

        try {
            const resolved = await getRubricVersionsByIds(event.context.drizzle as any, ids);
            expect(resolved.size).toBe(101);
        } finally {
            Map.prototype.keys = originalKeys;
        }

        expect(skipped).toBe(true);
    });

    it("treats a score payload that lost its tiebreak criterion as unranked by criterion", async () => {
        const team = {
            id: 1,
            name: "Edge Team",
            pathway: "junior",
            status: "active",
            score: null,
            score_exact: null,
            rank: null,
            project_submitted: 1,
            project_name: "",
            project_description: "",
            project_demo_url: null,
            project_repo_url: null,
            project_video_url: null,
            sourcing: "",
            season_id: seasonId,
            submitted_at: null,
            owner_user_id: null,
        };
        const version = {
            id: 1,
            season_id: seasonId,
            version: 1,
            name: "Edge",
            definition: DEFAULT_RUBRIC_DEFINITION,
            source_template_id: null,
            created_by: null,
            created_at: new Date(),
        };
        let reads = 0;
        const scores = {};
        for (const criterion of DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria) {
            Object.defineProperty(scores, criterion.id, {
                enumerable: true,
                get() {
                    if (criterion.id === "originality") {
                        reads += 1;
                        return reads < 3 ? 5 : undefined;
                    }
                    return 5;
                },
            });
        }
        const sentinel = "__missing_tiebreak__";
        const db = {
            select: () => ({
                from: (table: unknown) => {
                    if (table === teams) {
                        return { where: () => ({ orderBy: () => Promise.resolve([team]) }) };
                    }
                    if (table === rubricVersions) {
                        return { where: () => Promise.resolve([version]) };
                    }
                    return {
                        where: () =>
                            Promise.resolve([
                                {
                                    team_id: 1,
                                    judge_user_id: 1,
                                    season_id: seasonId,
                                    rubric_version_id: 1,
                                    scores: sentinel,
                                    reasoning: "",
                                },
                            ]),
                    };
                },
            }),
        };
        const originalParse = JSON.parse;
        JSON.parse = ((text: string) =>
            text === sentinel ? scores : originalParse(text)) as typeof JSON.parse;

        try {
            const ranked = await calculateSeasonScoresWithDatabase(db as any, seasonId);
            expect(ranked).toMatchObject([{ id: 1, score: 100, rank: 1 }]);
        } finally {
            JSON.parse = originalParse;
        }
    });

    it("compares a ranking row whose stored score is lost between reads", async () => {
        const score = JSON.stringify(
            Object.fromEntries(
                DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                    criterion.id,
                    5,
                ]),
            ),
        );
        let scoreReads = 0;
        const previousRow = new Proxy(
            {
                id: 1,
                pathway: "junior",
                status: "active",
                score: null,
                score_exact: null,
                rank: 1,
                submitted_at: null,
            },
            {
                get(target, property, receiver) {
                    if (property === "score") {
                        scoreReads += 1;
                        return scoreReads === 1 ? 100 : null;
                    }
                    return Reflect.get(target, property, receiver);
                },
            },
        );
        const version = {
            id: rubricVersionId,
            season_id: seasonId,
            version: 1,
            name: "Edge",
            definition: DEFAULT_RUBRIC_DEFINITION,
            source_template_id: null,
            created_by: null,
            created_at: new Date(),
        };
        const updateWhere = vi.fn().mockResolvedValue(undefined);
        const db = {
            select: () => ({
                from: (table: unknown) => ({
                    where: () =>
                        Promise.resolve(
                            table === teams
                                ? [previousRow]
                                : table === rubricVersions
                                  ? [version]
                                  : [
                                        {
                                            team_id: 1,
                                            judge_user_id: 1,
                                            season_id: seasonId,
                                            rubric_version_id: rubricVersionId,
                                            scores: score,
                                            reasoning: "",
                                        },
                                    ],
                        ),
                }),
            }),
            update: () => ({
                set: () => ({
                    from: () => ({ where: updateWhere }),
                }),
            }),
        };

        await recalculateTeamScoreAfterSubmission(
            db as any,
            seasonId,
            { id: 1, pathway: "junior" } as typeof teams.$inferSelect,
            version as any,
        );

        expect(updateWhere).toHaveBeenCalledOnce();
        expect(scoreReads).toBeGreaterThan(1);
    });
});
