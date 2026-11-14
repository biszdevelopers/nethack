import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMockEvent } from "./database/helpers";
import {
    calculateSeasonScores,
    calculateSeasonScoresWithDatabase,
    computeScores,
    recalculateTeamScoreAfterSubmission,
} from "~~/server/utils/scoring";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { rubricVersions, teams } from "~~/server/database/schema";

const seasonId = 42;

describe("judge score aggregation and ranking", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: any;
    let rubricVersionId: number;
    let nextTeamName: number;

    beforeEach(async () => {
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        nextTeamName = 1;
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(?, ?, 1)").run(
            seasonId,
            "Scoring Season",
        );
        rubricVersionId = Number(
            raw
                .prepare(
                    "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(?, 1, ?, ?)",
                )
                .run(seasonId, "Scoring Rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION))
                .lastInsertRowid,
        );
        raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?").run(
            rubricVersionId,
            seasonId,
        );
        raw.prepare("INSERT INTO users(email, role) VALUES(?, 'judge')").run(
            "judge-1@test.invalid",
        );
    });

    it("averages normalized weighted judge scores and ranks ties within each track", async () => {
        const tiedA = addTeam("junior");
        const tiedB = addTeam("junior");
        const lower = addTeam("junior");
        const senior = addTeam("senior");
        const secondJudgeId = addJudge("judge-2@test.invalid");

        addScore(tiedA, 5);
        addScore(tiedA, 3, secondJudgeId);
        addScore(tiedB, 4);
        addScore(lower, 2);
        addScore(senior, 5);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map(({ id, score, rank }) => ({ id, score, rank }))).toEqual([
            { id: tiedA, score: 80, rank: 1 },
            { id: tiedB, score: 80, rank: 1 },
            { id: lower, score: 40, rank: 3 },
            { id: senior, score: 100, rank: 1 },
        ]);
    });

    it("returns zero for submitted projects with no judge scores", async () => {
        const teamId = addTeam("junior");

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked).toMatchObject([{ id: teamId, score: 0, rank: 1 }]);
    });

    it("groups unassigned submitted projects into their own ranking track", async () => {
        const teamId = addTeam(null);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked).toMatchObject([{ id: teamId, pathway: null, score: 0, rank: 1 }]);
    });

    it("rejects saved score rows with malformed JSON", async () => {
        const teamId = addTeam("junior");
        addRawScore(teamId, "{");

        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "A saved judge score is not valid JSON.",
        });
    });

    it.each(["null", "[]"])("rejects saved scores with a non-object shape: %s", async (scores) => {
        const teamId = addTeam("junior");
        addRawScore(teamId, scores);

        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "A saved judge score has an invalid shape.",
        });
    });

    it("rejects scores whose team is not part of the submitted season", async () => {
        const teamId = addTeam("junior", { project_submitted: 0 });
        addScore(teamId, 5);

        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "A saved judge score is missing its team or rubric version.",
        });
    });

    it("rejects scores whose saved rubric version is unavailable", async () => {
        const teamId = addTeam("junior");
        addRawScore(teamId, scoreObject(5), { rubricVersionId: rubricVersionId + 100 });

        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "A saved judge score is missing its team or rubric version.",
        });
    });

    it.each([null, "unconfigured"])(
        "rejects scores without a matching rubric track: %s",
        async (pathway) => {
            const teamId = addTeam(pathway);
            addScore(teamId, 5);

            await expect(
                calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
            ).rejects.toMatchObject({
                statusCode: 409,
                message: "A saved judge score does not match its rubric track.",
            });
        },
    );

    it("rejects saved criterion scores outside the immutable rubric version", async () => {
        const teamId = addTeam("junior");
        addRawScore(teamId, scoreObject(6));

        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "A saved judge score does not match its rubric version.",
        });
    });

    it("persists scores and ranks in batches for more than 250 submitted projects", async () => {
        const teamIds = Array.from({ length: 251 }, (_, index) =>
            addTeam("junior", { name: `Team ${index}` }),
        );

        await calculateSeasonScores(event, seasonId, true);

        expect(
            raw
                .prepare(
                    "SELECT count(*) AS count FROM teams WHERE season_id = ? AND score = 0 AND rank = 1",
                )
                .get(seasonId),
        ).toEqual({ count: 251 });
        expect(teamIds).toHaveLength(251);
    });

    it("does not issue persistence work for a season without submitted projects", async () => {
        await expect(
            calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId, true),
        ).resolves.toEqual([]);
    });

    it("keeps the compatibility computation wrapper persisting final results", async () => {
        const teamId = addTeam("junior");
        addScore(teamId, 5);

        await computeScores(event, seasonId);

        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(teamId)).toEqual({
            score: 100,
            rank: 1,
        });
    });

    it("ranks null-pathway teams and normalizes uncached track scores", async () => {
        const targetId = addTeam(null);
        const scoredId = addTeam(null);
        const unscoredId = addTeam(null);
        raw.prepare("UPDATE teams SET score = 50, rank = 1 WHERE id = ?").run(scoredId);
        const target = event.context.drizzle
            .select()
            .from(teams)
            .where(eq(teams.id, targetId))
            .get() as typeof teams.$inferSelect;
        const version = event.context.drizzle
            .select()
            .from(rubricVersions)
            .where(eq(rubricVersions.id, rubricVersionId))
            .get() as typeof rubricVersions.$inferSelect;

        await recalculateTeamScoreAfterSubmission(event.context.drizzle, seasonId, target, version);

        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(targetId)).toEqual({
            score: 0,
            rank: 2,
        });
        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(unscoredId)).toEqual({
            score: 0,
            rank: 2,
        });
    });

    function addTeam(
        pathway: string | null,
        overrides: { name?: string; project_submitted?: number } = {},
    ) {
        const result = raw
            .prepare(
                "INSERT INTO teams(name, pathway, season_id, project_submitted) VALUES(?, ?, ?, ?)",
            )
            .run(
                overrides.name ?? `Team ${nextTeamName++}`,
                pathway,
                seasonId,
                overrides.project_submitted ?? 1,
            );
        return Number(result.lastInsertRowid);
    }

    function addJudge(email: string) {
        const result = raw.prepare("INSERT INTO users(email, role) VALUES(?, 'judge')").run(email);
        return Number(result.lastInsertRowid);
    }

    function addScore(teamId: number, value: number, judgeId = 1) {
        addRawScore(teamId, scoreObject(value), { judgeId });
    }

    function addRawScore(
        teamId: number,
        scores: string,
        overrides: { judgeId?: number; rubricVersionId?: number } = {},
    ) {
        raw.prepare(
            "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(?, ?, ?, '', ?, ?)",
        ).run(
            teamId,
            overrides.judgeId ?? 1,
            scores,
            seasonId,
            overrides.rubricVersionId ?? rubricVersionId,
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
});
