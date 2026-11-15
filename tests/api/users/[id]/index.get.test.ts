import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "../../helpers";
import { teamAwards, userPastTeams, awards } from "~~/server/database/schema";

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("getUserPastTeams", membersDb.getUserPastTeams);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeamById", teamsDb.getTeamById);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getScoreRankVisibilityResolver", seasonsDb.getScoreRankVisibilityResolver);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);

    const { convertUserToPublic, convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertUserToPublic", convertUserToPublic);
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    handler = (await import("~~/server/api/users/[id]/index.get")).default;
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

describe("GET /api/users/:id", () => {
    it("returns 404 when user does not exist", async () => {
        mockParams.values["id"] = "9999";

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found",
        });
    });

    it("returns public view for another user", async () => {
        const team = seedTeam(ctx, { name: "Private Team" });
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });
        const bob = seedUser(ctx, { email: "bob@basischina.com", name: "Bob" });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: bob.id } };

        const result = await handler(createEvent());

        expect(result).toMatchObject({
            id: alice.id,
            name: "Alice",
        });
        expect(result).not.toHaveProperty("email");
        expect(result).not.toHaveProperty("team_id");
        expect(result).not.toHaveProperty("team");
        expect(result).not.toHaveProperty("past_teams");
    });

    it("returns full profile for self with current team", async () => {
        const team = seedTeam(ctx, { name: "Current Team" });
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await handler(createEvent());

        expect(result).toMatchObject({ id: alice.id, email: "alice@basischina.com" });
        expect(result.team).toMatchObject({ name: "Current Team" });
        expect(result.past_teams).toEqual([]);
    });

    it("returns full profile for self with past teams", async () => {
        const pastTeam = seedTeam(ctx, { name: "Past Team" });
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

        ctx.drizzle.insert(userPastTeams).values({ user_id: alice.id, team_id: pastTeam.id }).run();

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await handler(createEvent());

        expect(result.past_teams).toHaveLength(1);
        expect(result.past_teams[0]).toMatchObject({ name: "Past Team" });
    });

    it("returns full profile for self with current team and past teams", async () => {
        const currentTeam = seedTeam(ctx, { name: "Current Team" });
        const pastTeam = seedTeam(ctx, { name: "Past Team" });
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: currentTeam.id,
        });

        ctx.drizzle.insert(userPastTeams).values({ user_id: alice.id, team_id: pastTeam.id }).run();

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await handler(createEvent());

        expect(result.team).toMatchObject({ name: "Current Team" });
        expect(result.past_teams).toHaveLength(1);
        expect(result.past_teams[0]).toMatchObject({ name: "Past Team" });
    });

    it("includes awards for self teams", async () => {
        const team = seedTeam(ctx, { name: "Awarded Team" });
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });

        ctx.drizzle
            .insert(awards)
            .values({
                namespace: "best_overall",
                name: "Best Overall",
                description: "Best overall team.",
                icon: "i-lucide-trophy",
                color: "gold",
            })
            .run();
        ctx.drizzle
            .insert(teamAwards)
            .values({ team_id: team.id, award: "best_overall", meta: "{}" })
            .run();

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await handler(createEvent());

        expect(result.team).toMatchObject({ name: "Awarded Team" });
        expect(result.team.awards).toHaveLength(1);
        expect(result.team.awards[0]).toMatchObject({ namespace: "best_overall" });
    });
});
