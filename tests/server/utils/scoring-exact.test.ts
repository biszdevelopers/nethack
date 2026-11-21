import { beforeEach, describe, expect, it } from "vitest";
import { createMockEvent } from "./database/helpers";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";

const seasonId = 7;
const rubric = {
    tracks: {
        junior: {
            name: "Junior",
            criteria: [
                {
                    id: "a",
                    name: "Alpha",
                    description: "",
                    weight: 50,
                    minScore: 0,
                    maxScore: 5,
                },
                {
                    id: "b",
                    name: "Beta",
                    description: "",
                    weight: 50,
                    minScore: 0,
                    maxScore: 5,
                },
            ],
        },
    },
};

describe("exact score ranking", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: any;
    let versionId: number;

    beforeEach(async () => {
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(?, ?, 1)").run(
            seasonId,
            "Exact season",
        );
        versionId = Number(
            raw
                .prepare(
                    "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(?, 1, 'Exact', ?)",
                )
                .run(seasonId, JSON.stringify(rubric)).lastInsertRowid,
        );
        raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?").run(
            versionId,
            seasonId,
        );
    });

    function addTeam(name: string, options: { status?: string; submittedAt?: string } = {}) {
        return Number(
            raw
                .prepare(
                    "INSERT INTO teams(name, pathway, season_id, project_submitted, status, submitted_at) VALUES(?, 'junior', ?, 1, ?, ?)",
                )
                .run(name, seasonId, options.status ?? "active", options.submittedAt ?? null)
                .lastInsertRowid,
        );
    }

    function addJudge(email: string) {
        return Number(raw.prepare("INSERT INTO users(email) VALUES(?)").run(email).lastInsertRowid);
    }

    function addScore(teamId: number, judgeId: number, a: number, b: number) {
        raw.prepare(
            "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(?, ?, ?, '', ?, ?)",
        ).run(teamId, judgeId, JSON.stringify({ a, b }), seasonId, versionId);
    }

    it("ranks equal exact scores by the highest-weight criterion", async () => {
        const judge1 = addJudge("j1@test.invalid");
        const judge2 = addJudge("j2@test.invalid");
        const strongAlpha = addTeam("Alpha team");
        const strongBeta = addTeam("Beta team");
        addScore(strongAlpha, judge1, 5, 3);
        addScore(strongBeta, judge2, 3, 5);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map(({ id, score_exact, rank }) => ({ id, score_exact, rank }))).toEqual([
            { id: strongAlpha, score_exact: 80, rank: 1 },
            { id: strongBeta, score_exact: 80, rank: 2 },
        ]);
    });

    it("keeps the unrounded exact average beside the rounded display score", async () => {
        const judge1 = addJudge("j1@test.invalid");
        const judge2 = addJudge("j2@test.invalid");
        const judge3 = addJudge("j3@test.invalid");
        const teamId = addTeam("Fractional team");
        addScore(teamId, judge1, 5, 5);
        addScore(teamId, judge2, 4, 4);
        addScore(teamId, judge3, 4, 4);

        const [ranked] = await calculateSeasonScoresWithDatabase(
            event.context.drizzle,
            seasonId,
            true,
        );

        expect(ranked!.score_exact).toBeCloseTo(86.6667, 3);
        expect(ranked!.score).toBe(87);
        expect(
            raw.prepare("SELECT score, score_exact FROM teams WHERE id = ?").get(teamId),
        ).toMatchObject({ score: 87 });
    });

    it("excludes non-active teams from ranking while keeping them visible", async () => {
        const judge = addJudge("j1@test.invalid");
        const active = addTeam("Active team");
        const withdrawn = addTeam("Withdrawn team", { status: "withdrawn" });
        addScore(active, judge, 3, 3);
        addScore(withdrawn, judge, 5, 5);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.find((team) => team.id === withdrawn)).toMatchObject({
            score: 100,
            rank: null,
            status: "withdrawn",
        });
        expect(ranked.find((team) => team.id === active)).toMatchObject({ rank: 1 });
    });

    it("breaks remaining ties by submission time and then id", async () => {
        const judge1 = addJudge("j1@test.invalid");
        const judge2 = addJudge("j2@test.invalid");
        const later = addTeam("Later team", { submittedAt: "2026-01-02T00:00:00.000Z" });
        const earlier = addTeam("Earlier team", { submittedAt: "2026-01-01T00:00:00.000Z" });
        addScore(later, judge1, 4, 4);
        addScore(earlier, judge2, 4, 4);

        const ranked = await calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId);

        expect(ranked.map((team) => team.id)).toEqual([earlier, later]);
        expect(ranked.map((team) => team.rank)).toEqual([1, 2]);
    });
});
