import { eq } from "drizzle-orm";
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
import { rubricVersions, seasons, teamScores, teams } from "~~/server/database/schema";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { NethackPermissions } from "~~/shared/permissions";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 120, windowMs: 60_000 },
}));

let ctx: TestContext;
let participantHandler: any;
let adminHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    participantHandler = (await import("~~/server/api/teams/[id]/scores.get")).default;
    adminHandler = (await import("~~/server/api/admin/teams/[id]/scores.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
});

afterEach(() => resetTestContext(ctx));

function createEvent() {
    return { context: { drizzle: ctx.drizzle } };
}

async function seedPublishedEvaluation(
    flags: { show_scores?: number; show_ranking?: number; score_curve_preset?: string } = {},
) {
    const season = seedSeason(ctx, {
        results_published: 1,
        show_scores: flags.show_scores ?? 1,
        show_ranking: flags.show_ranking ?? 1,
        score_curve_preset: flags.score_curve_preset ?? "original",
    });
    const team = seedTeam(ctx, {
        name: "Published team",
        pathway: "junior",
        project_submitted: 1,
    });
    const member = seedUser(ctx, {
        email: "participant@example.test",
        team_id: team.id,
    });
    const judge = seedUser(ctx, { email: "judge@example.test", role: "judge" });
    const version = await ctx.drizzle
        .select()
        .from(rubricVersions)
        .where(eq(rubricVersions.id, season.rubric_version_id!))
        .get();
    const scores = Object.fromEntries(
        DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
            criterion.id,
            criterion.maxScore - 1,
        ]),
    );
    ctx.drizzle
        .insert(teamScores)
        .values({
            team_id: team.id,
            judge_user_id: judge.id,
            season_id: season.id,
            rubric_version_id: version!.id,
            scores: JSON.stringify(scores),
            reasoning: "A useful and anonymous comment.",
        })
        .run();
    ctx.drizzle
        .update(seasons)
        .set({ score_curve_preset: flags.score_curve_preset ?? "original" })
        .where(eq(seasons.id, season.id))
        .run();
    ctx.drizzle.update(teams).set({ score: 80, rank: 1 }).where(eq(teams.id, team.id)).run();
    mockParams.values.id = String(team.id);
    mockSession.value = { user: { id: member.id } };
    return { season, team, member, judge };
}

describe("GET /api/teams/:id/scores", () => {
    it("withholds score and rank when the season visibility settings hide them", async () => {
        const { team } = await seedPublishedEvaluation({ show_scores: 0, show_ranking: 0 });

        const response = await participantHandler(createEvent());

        expect(response).toMatchObject({
            team_id: team.id,
            original_score: null,
            displayed_score: null,
            rank: null,
            feedback: [
                {
                    reasoning: "A useful and anonymous comment.",
                    scores: null,
                    normalized_score: null,
                    criteria: null,
                },
            ],
        });
        expect(JSON.stringify(response)).not.toMatch(/judge_user_id|judge@example\.test/);
    });

    it("returns original and curved scores separately when score display is enabled", async () => {
        const { team } = await seedPublishedEvaluation({ score_curve_preset: "gentle" });

        const response = await participantHandler(createEvent());

        expect(response.original_score).toBe(80);
        expect(response.displayed_score).toBeGreaterThanOrEqual(response.original_score);
        expect(response.feedback[0].normalized_score).toBe(80);
        expect(JSON.stringify(response)).not.toMatch(/judge_user_id|judge@example\.test/);
        expect(response.feedback[0].reasoning).toBe("A useful and anonymous comment.");
    });

    it("does not reveal another team's feedback to a non-member", async () => {
        const { team } = await seedPublishedEvaluation();
        const stranger = seedUser(ctx, { email: "stranger@example.test" });
        mockSession.value = { user: { id: stranger.id } };

        await expect(participantHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
        expect(mockParams.values.id).toBe(String(team.id));
    });

    it("withholds comments until results are published", async () => {
        const { season, team } = await seedPublishedEvaluation();
        ctx.drizzle
            .update(seasons)
            .set({ results_published: 0 })
            .where(eq(seasons.id, season.id))
            .run();

        await expect(participantHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(team.id).toBe(Number(mockParams.values.id));
    });
});

describe("GET /api/admin/teams/:id/scores", () => {
    it("requires the explicit administrator permission", async () => {
        const requireUser = vi.mocked(globalThis.requireUser);
        requireUser.mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));

        await expect(adminHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(requireUser).toHaveBeenCalledWith(expect.anything(), NethackPermissions.all);
    });
});
