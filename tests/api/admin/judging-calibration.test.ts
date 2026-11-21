import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockQueryState,
    mockSession,
    resetMockState,
    resetTestContext,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { teamScores } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();
    handler = (await import("~~/server/api/admin/judging/calibration.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
});

afterEach(() => {
    resetTestContext(ctx);
});

function event() {
    return { context: { drizzle: ctx.drizzle }, path: "/api/admin/judging/calibration" };
}

function scores(value: number) {
    return JSON.stringify({
        originality: value,
        presentation: value,
        technicality: value,
        theme: value,
        impact: value,
    });
}

function seedEvaluation(
    seasonId: number,
    rubricVersionId: number,
    judgeId: number,
    teamId: number,
    raw: string,
) {
    ctx.drizzle
        .insert(teamScores)
        .values({
            team_id: teamId,
            judge_user_id: judgeId,
            season_id: seasonId,
            rubric_version_id: rubricVersionId,
            scores: raw,
            reasoning: "Feedback",
        } as any)
        .run();
}

describe("GET /api/admin/judging/calibration", () => {
    it("returns 404 when no season exists", async () => {
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        mockSession.value = { user: { id: admin.id } };

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("summarizes judge averages and flags a low outlier", async () => {
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        mockSession.value = { user: { id: admin.id } };
        const season = seedSeason(ctx, { name: "Calibration" });
        mockQueryState.value = { season_id: season.id };
        const teams = [1, 2, 3, 4].map((index) =>
            seedTeam(ctx, {
                name: `Team ${index}`,
                season_id: season.id,
                project_submitted: 1,
                pathway: "junior",
            }),
        );
        const judges = Array.from({ length: 8 }, (_, index) =>
            seedUser(ctx, { email: `judge${index + 1}@basischina.com` }),
        );
        for (const judge of judges) {
            for (const team of teams) {
                seedEvaluation(
                    season.id,
                    season.rubric_version_id!,
                    judge.id,
                    team.id,
                    scores(judge.id === judges[7]!.id ? 0 : 5),
                );
            }
        }

        const result = await handler(event());

        expect(result.evaluations).toBe(32);
        expect(result.judges).toHaveLength(8);
        expect(result.outliers).toHaveLength(1);
        expect(result.outliers[0]!.judge_user_id).toBe(judges[7]!.id);
        expect(result.overall_average).toBeTypeOf("number");
    });

    it("ignores unreadable or mismatched evaluations and handles an empty season", async () => {
        const admin = seedUser(ctx, { email: "empty-admin@basischina.com", is_admin: 1 });
        mockSession.value = { user: { id: admin.id } };
        const season = seedSeason(ctx, { name: "Empty calibration" });
        const team = seedTeam(ctx, {
            name: "Empty team",
            season_id: season.id,
            project_submitted: 1,
            pathway: "junior",
        });
        const judge = seedUser(ctx, { email: "judge-empty@basischina.com" });
        const otherJudge = seedUser(ctx, { email: "judge-other@basischina.com" });
        const shapeJudges = [1, 2, 3].map((index) =>
            seedUser(ctx, { email: `judge-shape${index}@basischina.com`, name: null }),
        );
        seedEvaluation(season.id, season.rubric_version_id!, judge.id, team.id, "not-json");
        seedEvaluation(season.id, 999_999, otherJudge.id, team.id, scores(5));
        seedEvaluation(season.id, season.rubric_version_id!, shapeJudges[0]!.id, team.id, "[]");
        seedEvaluation(season.id, season.rubric_version_id!, shapeJudges[1]!.id, team.id, "null");
        seedEvaluation(season.id, season.rubric_version_id!, shapeJudges[2]!.id, team.id, "5");

        const result = await handler(event());

        expect(result.evaluations).toBe(0);
        expect(result.overall_average).toBeNull();
        expect(result.judges).toEqual([]);
        expect(result.outliers).toEqual([]);
    });
});
