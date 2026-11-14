import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "./helpers";
import { eq } from "drizzle-orm";
import { users, teams, userPastTeams } from "~~/server/database/schema";
import { clearRateLimitHistory } from "~~/server/utils/rateLimit";

let ctx: TestContext;
let listHandler: any;
let getHandler: any;
let patchHandler: any;
let deleteHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    // Stub database functions using real implementations
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    vi.stubGlobal("updateUserName", usersDb.updateUserName);
    vi.stubGlobal("updateUserProfileTheme", usersDb.updateUserProfileTheme);
    vi.stubGlobal("updateUserProfilePicture", usersDb.updateUserProfilePicture);
    vi.stubGlobal("deleteUsers", usersDb.deleteUsers);

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("getUserPastTeams", membersDb.getUserPastTeams);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeamById", teamsDb.getTeamById);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getScoreRankVisibilityResolver", seasonsDb.getScoreRankVisibilityResolver);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);

    const { convertUserToPublic, convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertUserToPublic", convertUserToPublic);
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    // Mock asset helpers
    vi.stubGlobal("createUserAsset", vi.fn().mockResolvedValue("/assets/test.png"));
    vi.stubGlobal("removeUserAsset", vi.fn().mockResolvedValue(undefined));

    listHandler = (await import("~~/server/api/users/index.get")).default;
    getHandler = (await import("~~/server/api/users/[id]/index.get")).default;
    patchHandler = (await import("~~/server/api/users/[id]/index.patch")).default;
    deleteHandler = (await import("~~/server/api/users/index.delete")).default;
});

beforeEach(async () => {
    clearRateLimitHistory();
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    const body = Buffer.from(JSON.stringify(mockBody.value ?? {}));
    const request = Object.assign(Readable.from([body]), {
        headers: {
            "content-length": String(body.byteLength),
            "content-type": "application/json",
        },
        socket: { remoteAddress: "127.0.0.1" },
    });

    return {
        context: { drizzle: ctx.drizzle },
        node: { req: request, res: { headersSent: false, setHeader() {} } },
        ...overrides,
    };
}

describe("GET /api/users", () => {
    it("requires PORTAL_USERS_VIEW permission", async () => {
        vi.mocked(globalThis.requirePermission).mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(listHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it("returns all users with past team IDs", async () => {
        vi.mocked(globalThis.requirePermission).mockResolvedValue({ id: 1, role: "admin" });

        seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
        seedUser(ctx, { email: "bob@basischina.com", name: "Bob" });

        const result = await listHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty("email", "alice@basischina.com");
        expect(result[1]).toHaveProperty("email", "bob@basischina.com");
    });
});

describe("GET /api/users/:id", () => {
    it("returns 404 for non-existing user", async () => {
        mockParams.values["id"] = "9999";

        // getUser returns null → 404
        const { requirePermission } = await import("~~/server/utils/auth");

        await expect(getHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("returns public view for other users", async () => {
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
        const bob = seedUser(ctx, { email: "bob@basischina.com", name: "Bob" });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: bob.id } };

        const result = await getHandler(createEvent());

        expect(result).toHaveProperty("id", alice.id);
        expect(result).not.toHaveProperty("email");
        // Public view should not include team/past_teams
        expect(result).not.toHaveProperty("team");
        expect(result).not.toHaveProperty("past_teams");
    });

    it("returns full profile for self", async () => {
        const team = seedTeam(ctx, { name: "My Team" });
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await getHandler(createEvent());

        expect(result).toHaveProperty("id", alice.id);
        expect(result).toHaveProperty("team");
        expect(result.team).toHaveProperty("name", "My Team");
        expect(result).toHaveProperty("past_teams");
    });

    it("hides score and rank for self when hackathon toggles are off", async () => {
        const team = seedTeam(ctx, { name: "Scored Team" });
        ctx.drizzle.update(teams).set({ score: 95, rank: 1 }).where(eq(teams.id, team.id)).run();
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await getHandler(createEvent());

        expect(result.team.score).toBeNull();
        expect(result.team.rank).toBeNull();
    });

    it("shows score and rank for self when the season toggles are on", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx);
        const season = seedSeason(ctx, { show_scores: 1, show_ranking: 1 });

        const team = seedTeam(ctx, { name: "Scored Team", season_id: season.id });
        ctx.drizzle.update(teams).set({ score: 95, rank: 1 }).where(eq(teams.id, team.id)).run();
        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: team.id,
        });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await getHandler(createEvent());

        expect(result.team.score).toBe(95);
        expect(result.team.rank).toBe(1);
    });

    it("shows score and rank for privileged roles regardless of toggles", async () => {
        const team = seedTeam(ctx, { name: "Scored Team" });
        ctx.drizzle.update(teams).set({ score: 95, rank: 1 }).where(eq(teams.id, team.id)).run();
        const admin = seedUser(ctx, {
            email: "admin@basischina.com",
            name: "Admin",
            team_id: team.id,
            role: "admin",
        });

        mockParams.values["id"] = String(admin.id);
        mockSession.value = { user: { id: admin.id } };

        const result = await getHandler(
            createEvent({
                context: {
                    drizzle: ctx.drizzle,
                    oauth2: { permissions: ["nethack.Judging.resultsRead"] },
                },
            }),
        );

        expect(result.team.score).toBe(95);
        expect(result.team.rank).toBe(1);
    });

    it("binds past team visibility to each team's own season", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { show_scores: 1, show_ranking: 1 });
        const liveSeason = seedSeason(ctx, {
            name: "Live Season",
            show_scores: 1,
            show_ranking: 1,
        });
        const oldSeason = seedSeason(ctx, {
            name: "Old Season",
            is_active: 0,
            show_scores: 0,
            show_ranking: 0,
        });

        const currentTeam = seedTeam(ctx, { name: "Current Team", season_id: liveSeason.id });
        const pastTeam = seedTeam(ctx, { name: "Past Team", season_id: oldSeason.id });
        ctx.drizzle
            .update(teams)
            .set({ score: 95, rank: 1 })
            .where(eq(teams.id, currentTeam.id))
            .run();
        ctx.drizzle
            .update(teams)
            .set({ score: 80, rank: 2 })
            .where(eq(teams.id, pastTeam.id))
            .run();

        const alice = seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
            team_id: currentTeam.id,
        });
        ctx.drizzle.insert(userPastTeams).values({ user_id: alice.id, team_id: pastTeam.id }).run();

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };

        const result = await getHandler(createEvent());

        expect(result.team.score).toBe(95);
        expect(result.team.rank).toBe(1);
        expect(result.past_teams).toHaveLength(1);
        expect(result.past_teams[0].score).toBeNull();
        expect(result.past_teams[0].rank).toBeNull();
    });
});

describe("PATCH /api/users/:id", () => {
    it("returns 403 when updating another user", async () => {
        seedUser(ctx, { email: "viewer@basischina.com" });
        mockParams.values["id"] = "2";
        mockSession.value = { user: { id: 1 } };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it("returns 401 when user is not found", async () => {
        mockParams.values["id"] = "9999";
        mockSession.value = { user: { id: 9999 } };
        mockBody.value = { name: "Test" };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({
            statusCode: 401,
        });
    });

    it("updates user name", async () => {
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };
        mockBody.value = { name: "Alice Updated" };

        const result = await patchHandler(createEvent());

        expect(result).toEqual({ message: "Your profile is updated" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
        expect(updated!.name).toBe("Alice Updated");
    });
});

describe("DELETE /api/users", () => {
    it("requires USERS permission", async () => {
        (globalThis as any).requirePermission.mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        mockBody.value = { ids: [1] };

        await expect(deleteHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it("deletes users by IDs", async () => {
        vi.mocked(globalThis.requirePermission).mockResolvedValue({ id: 1, role: "admin" });

        const alice = seedUser(ctx, { email: "alice@basischina.com" });
        const bob = seedUser(ctx, { email: "bob@basischina.com" });

        mockBody.value = { ids: [alice.id, bob.id] };

        const result = await deleteHandler(createEvent());

        expect(result).toEqual({ message: "Deleted 2 user(s)" });

        const remaining = ctx.drizzle.select().from(users).all();
        expect(remaining).toHaveLength(0);
    });
});
