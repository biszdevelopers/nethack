import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockQueryState,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    type TestContext,
} from "./helpers";
import { teamScores } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let scoresHandler: any;
let teamsHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getAllTeams", teamsDb.getAllTeams);
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("updateTeam", teamsDb.updateTeam);

    const scoresDb = await import("~~/server/utils/database/scores");
    vi.stubGlobal("getTeamScoresByTeamID", scoresDb.getTeamScoresByTeamID);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);

    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    scoresHandler = (await import("~~/server/api/admin/scores.get")).default;
    teamsHandler = (await import("~~/server/api/admin/teams.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return {
        context: { drizzle: ctx.drizzle },
        ...overrides,
    };
}

function gRequireAdmin() {
    return vi.mocked(globalThis.requireAdmin);
}

function gRequirePermission() {
    return vi.mocked(globalThis.requirePermission);
}

describe("GET /api/admin/scores", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns teams with computed scores and rankings", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        seedTeam(ctx, {
            name: "Alpha Team",
            pathway: "junior",
            project_submitted: 1,
        });
        seedTeam(ctx, {
            name: "Beta Team",
            pathway: "senior",
            project_submitted: 1,
        });

        const result = await scoresHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("updates scores when update query is set", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        seedTeam(ctx, {
            name: "Team",
            pathway: "junior",
            project_submitted: 1,
        });

        mockQueryState.value = { update: "true" };

        const result = await scoresHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
    });

    it("validates update query parameter through schema", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedTeam(ctx, {
            name: "Team",
            pathway: "junior",
            project_submitted: 1,
        });

        const originalGetValidatedQuery = globalThis.getValidatedQuery;
        vi.stubGlobal("getValidatedQuery", async (_event: any, schema: any) => {
            const validate = typeof schema === "function" ? schema : schema.parse;
            return validate(mockQueryState.value);
        });

        try {
            mockQueryState.value = { update: "true" };
            const result = await scoresHandler(createEvent());
            expect(Array.isArray(result)).toBe(true);
        } finally {
            vi.stubGlobal("getValidatedQuery", originalGetValidatedQuery);
        }
    });

    it("computes weighted scores from judge scores", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        const team = seedTeam(ctx, {
            name: "Scored Team",
            pathway: "junior",
            project_submitted: 1,
        });
        seedUser(ctx, { email: "judge@basischina.com", role: "judge" });

        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: team.id,
                judge_user_id: 1,
                season_id: 1,
                rubric_version_id: 1,
                scores: JSON.stringify({
                    originality: 5,
                    presentation: 5,
                    technicality: 5,
                    theme: 5,
                    impact: 5,
                }),
                reasoning: "Perfect project.",
            })
            .run();

        const result = await scoresHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(1);
        const scored = result.find((t: any) => t.id === team.id);
        expect(scored).toBeDefined();
        expect(scored.score).toBe(100);
    });

    it("handles tied scores and sorts by rank within pathway", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedUser(ctx, { email: "judge@basischina.com", role: "judge" });

        const teamA = seedTeam(ctx, {
            name: "Team A",
            pathway: "junior",
            project_submitted: 1,
        });
        const teamB = seedTeam(ctx, {
            name: "Team B",
            pathway: "junior",
            project_submitted: 1,
        });
        const teamC = seedTeam(ctx, {
            name: "Team C",
            pathway: "junior",
            project_submitted: 1,
        });

        const perfectScores = {
            originality: 5,
            presentation: 5,
            technicality: 5,
            theme: 5,
            impact: 5,
        };
        const lowScores = {
            originality: 2,
            presentation: 2,
            technicality: 2,
            theme: 2,
            impact: 2,
        };

        ctx.drizzle
            .insert(teamScores)
            .values([
                {
                    team_id: teamA.id,
                    judge_user_id: 1,
                    season_id: 1,
                    rubric_version_id: 1,
                    scores: JSON.stringify(perfectScores),
                    reasoning: "",
                },
                {
                    team_id: teamB.id,
                    judge_user_id: 1,
                    season_id: 1,
                    rubric_version_id: 1,
                    scores: JSON.stringify(perfectScores),
                    reasoning: "",
                },
                {
                    team_id: teamC.id,
                    judge_user_id: 1,
                    season_id: 1,
                    rubric_version_id: 1,
                    scores: JSON.stringify(lowScores),
                    reasoning: "",
                },
            ])
            .run();

        const result = await scoresHandler(createEvent());

        const foundA = result.find((t: any) => t.id === teamA.id);
        const foundB = result.find((t: any) => t.id === teamB.id);
        const foundC = result.find((t: any) => t.id === teamC.id);

        expect(foundA.rank).toBe(1);
        expect(foundB.rank).toBe(1);
        expect(foundC.rank).toBe(3);

        const juniorTeams = result.filter((t: any) => t.pathway === "junior");
        expect(juniorTeams[0].rank).toBe(1);
        expect(juniorTeams[1].rank).toBe(1);
        expect(juniorTeams[2].rank).toBe(3);
    });
});

describe("GET /api/admin/teams", () => {
    it("requires TEAMS permission", async () => {
        gRequirePermission().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(teamsHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns all teams with season names", async () => {
        gRequirePermission().mockResolvedValue({ id: 1, role: "admin" });

        seedTeam(ctx, { name: "Team A" });
        seedTeam(ctx, { name: "Team B" });

        const result = await teamsHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty("name", "Team A");
        expect(result[0]).toHaveProperty("season_name", "Season 1");
        expect(result[0]).toHaveProperty("members", []);
        expect(result[1]).toHaveProperty("name", "Team B");
        expect(result[1]).toHaveProperty("members", []);
    });

    it("returns members grouped by team", async () => {
        gRequirePermission().mockResolvedValue({ id: 1, role: "admin" });

        const teamA = seedTeam(ctx, { name: "Team A" });
        const teamB = seedTeam(ctx, { name: "Team B" });

        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: teamA.id,
        });
        const bob = seedUser(ctx, {
            email: "bob@basischina.com",
            name: "Bob",
            team_id: teamA.id,
        });
        const carol = seedUser(ctx, {
            email: "carol@basischina.com",
            name: "Carol",
            team_id: teamB.id,
        });
        seedUser(ctx, { email: "teamless@basischina.com", name: "Teamless" });

        const result = await teamsHandler(createEvent());

        expect(result[0].members).toHaveLength(2);
        expect(result[0].members[0]).toMatchObject({
            id: alice.id,
            name: "Alice",
            email: "alice@basischina.com",
        });
        expect(result[0].members[1]).toMatchObject({
            id: bob.id,
            name: "Bob",
            email: "bob@basischina.com",
        });

        expect(result[1].members).toHaveLength(1);
        expect(result[1].members[0]).toMatchObject({
            id: carol.id,
            name: "Carol",
            email: "carol@basischina.com",
        });
    });
});
