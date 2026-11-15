import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockParams,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { awards, teamAwards, teamScores } from "~~/server/database/schema";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

const passingScores = {
    originality: 5,
    presentation: 5,
    technicality: 5,
    theme: 5,
    impact: 5,
};

let ctx: TestContext;
let handler: any;
let judgeId: number;

beforeAll(async () => {
    setupNitroGlobals();
    const seasonsDb = await import("~~/server/utils/database/seasons");
    const awardsDb = await import("~~/server/utils/database/awards");
    const convert = await import("~~/server/utils/convert");
    vi.stubGlobal("getSeasonById", seasonsDb.getSeasonById);
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);
    vi.stubGlobal("convertTeamToPublic", convert.convertTeamToPublic);
    handler = (await import("~~/server/api/judging/history/[seasonId].get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "finished", judging_open: 0 });
    judgeId = seedUser(ctx, { email: "judge@basischina.com", role: "judge" }).id;
    mockSession.value = { user: { id: judgeId } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return { context: { drizzle: ctx.drizzle } } as any;
}

function addEvaluation(
    seasonId: number,
    teamId: number,
    overrides: Record<string, unknown> = {},
    judge = judgeId,
) {
    ctx.drizzle
        .insert(teamScores)
        .values({
            team_id: teamId,
            judge_user_id: judge,
            season_id: seasonId,
            rubric_version_id: null,
            scores: JSON.stringify(passingScores),
            reasoning: "A careful evaluation.",
            ...overrides,
        } as any)
        .run();
}

describe("GET /api/judging/history/:seasonId", () => {
    it("returns only the signed-in judge's finalized evaluations", async () => {
        const season = seedSeason(ctx, { name: "Beneath the surface" });
        const otherSeason = seedSeason(ctx, { name: "Other", is_active: 0 });
        const awardedTeam = seedTeam(ctx, {
            name: "Awarded Team",
            pathway: "junior",
            project_submitted: 1,
            season_id: season.id,
            project_name: "Awarded Project",
            project_description: "An award-winning project.",
            project_repo_url: "https://github.com/example/project",
            project_demo_url: "https://example.test/demo",
            sourcing: "We used AI to draft documentation.",
        });
        const plainTeam = seedTeam(ctx, {
            name: "Plain Team",
            pathway: "junior",
            project_submitted: 1,
            season_id: season.id,
            project_name: "Plain Project",
        });
        const otherJudgeTeam = seedTeam(ctx, {
            name: "Other Judge Team",
            pathway: "junior",
            project_submitted: 1,
            season_id: season.id,
        });
        const otherSeasonTeam = seedTeam(ctx, {
            name: "Other Season Team",
            pathway: "junior",
            project_submitted: 1,
            season_id: otherSeason.id,
        });
        const otherJudge = seedUser(ctx, { email: "other@basischina.com", role: "judge" });

        ctx.drizzle
            .insert(awards)
            .values({
                namespace: "clean-code",
                name: "Clean Code",
                description: "Clear and maintainable implementation.",
                icon: "check",
                color: "green",
            })
            .run();
        ctx.drizzle
            .insert(teamAwards)
            .values({ team_id: awardedTeam.id, award: "clean-code", meta: "{}" })
            .run();

        addEvaluation(season.id, awardedTeam.id, {
            rubric_version_id: season.rubric_version_id,
            reasoning: "Strong originality and polish.",
        });
        addEvaluation(season.id, plainTeam.id, {
            rubric_version_id: season.rubric_version_id,
        });
        addEvaluation(season.id, otherJudgeTeam.id, {}, otherJudge.id);
        addEvaluation(otherSeason.id, otherSeasonTeam.id, {
            rubric_version_id: otherSeason.rubric_version_id,
        });

        mockParams.values.seasonId = String(season.id);
        const result = await handler(createEvent());

        expect(result.season).toEqual({ id: season.id, name: "Beneath the surface" });
        expect(result.unavailable_evaluations).toBe(0);
        expect(result.items).toHaveLength(2);

        const awarded = result.items.find(
            (item: JudgingHistoryItem) => item.team.id === awardedTeam.id,
        )!;
        expect(awarded).toMatchObject({
            rubric_name: "Test rubric",
            rubric_version: 1,
            track_name: "Junior",
            normalized_score: 100,
            reasoning: "Strong originality and polish.",
            criteria: DEFAULT_RUBRIC_DEFINITION.tracks.junior!.criteria,
        });
        expect(awarded.scores).toEqual(passingScores);
        expect(awarded.team).toMatchObject({
            id: awardedTeam.id,
            name: "Awarded Team",
            pathway: "junior",
            season_id: season.id,
            project: {
                name: "Awarded Project",
                description: "An award-winning project.",
                repo_url: "https://github.com/example/project",
                demo_url: "https://example.test/demo",
                submitted: true,
                sourcing: "We used AI to draft documentation.",
            },
        });
        expect(awarded.team.awards).toHaveLength(1);
        expect(awarded.team.awards[0]).toMatchObject({ name: "Clean Code" });

        const plain = result.items.find(
            (item: JudgingHistoryItem) => item.team.id === plainTeam.id,
        )!;
        expect(plain.team.awards).toEqual([]);
        expect(result.items.map((item: JudgingHistoryItem) => item.team.id)).not.toContain(
            otherJudgeTeam.id,
        );
        expect(result.items.map((item: JudgingHistoryItem) => item.team.id)).not.toContain(
            otherSeasonTeam.id,
        );
    });

    it("returns an empty history when the judge has no evaluations", async () => {
        const season = seedSeason(ctx, { name: "Quiet season" });
        mockParams.values.seasonId = String(season.id);

        const result = await handler(createEvent());

        expect(result).toMatchObject({
            season: { id: season.id, name: "Quiet season" },
            items: [],
            unavailable_evaluations: 0,
        });
    });

    it("rejects an unknown season", async () => {
        mockParams.values.seasonId = "987";

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("requires a signed-in judge", async () => {
        const season = seedSeason(ctx);
        mockSession.value = undefined;
        mockParams.values.seasonId = String(season.id);

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("skips evaluations whose saved rubric or scores cannot be displayed", async () => {
        const season = seedSeason(ctx);
        const rubricVersionId = season.rubric_version_id;
        const teams = [
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
            seedTeam(ctx, { pathway: null, season_id: season.id }),
            seedTeam(ctx, { pathway: "junior", season_id: season.id }),
        ];
        const payloads = [
            "not json",
            "null",
            "[1,2,3]",
            '"5"',
            JSON.stringify({ ...passingScores, originality: "5" }),
            JSON.stringify(passingScores),
            JSON.stringify({ ...passingScores, originality: 99 }),
        ];
        teams.forEach((team, index) => {
            addEvaluation(season.id, team.id, {
                rubric_version_id: rubricVersionId,
                scores: payloads[index],
            });
        });

        mockParams.values.seasonId = String(season.id);
        const result = await handler(createEvent());

        expect(result.items).toEqual([]);
        expect(result.unavailable_evaluations).toBe(teams.length);
    });

    it("counts legacy evaluations without a rubric version as unavailable", async () => {
        const season = seedSeason(ctx);
        const team = seedTeam(ctx, { pathway: "junior", season_id: season.id });
        addEvaluation(season.id, team.id, { rubric_version_id: null, season_id: null });

        mockParams.values.seasonId = String(season.id);
        const result = await handler(createEvent());

        expect(result.items).toEqual([]);
        expect(result.unavailable_evaluations).toBe(1);
    });
});
