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
} from "../../../../helpers";
import { users } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

vi.mock("~~/server/utils/auth", () => ({
    requireUser: vi.fn((...args: any[]) => (globalThis as any).requireUser(...args)),
    requireJudge: vi.fn((...args: any[]) => (globalThis as any).requireJudge(...args)),
    requireAdmin: vi.fn((...args: any[]) => (globalThis as any).requireAdmin(...args)),
    requirePermission: vi.fn((...args: any[]) => (globalThis as any).requirePermission(...args)),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("removeTeamMember", membersDb.removeTeamMember);

    handler = (await import("~~/server/api/teams/[id]/users/[user]/index.delete")).default;
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

describe("DELETE /api/teams/:id/users/:user", () => {
    it("returns 404 for a team from a previous season", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past", is_active: 0 });
        const staleTeam = seedTeam(ctx, { name: "Old team", season_id: pastSeason.id });
        const owner = seedUser(ctx, { email: "owner@basischina.com", team_id: staleTeam.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(staleTeam.id);
        mockParams.values["user"] = String(owner.id);

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("removes a user from the team", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Removed user from the team" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, member.id)).get();
        expect(updated!.team_id).toBeNull();
    });

    it("returns 403 when current user is not a team member", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const otherTeam = seedTeam(ctx, { name: "Other Team" });
        seedUser(ctx, { email: "outsider@basischina.com", team_id: otherTeam.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members of other teams",
        });
    });

    it("returns 403 when hackathon has finished", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "finished" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after hackathon has finished",
        });
    });

    it("returns 403 when hackathon status is voting", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "voting" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Voting Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after hackathon has finished",
        });
    });

    it("returns 403 when project is already submitted", async () => {
        const team = seedTeam(ctx, { name: "Team", project_submitted: 1 });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after project is submitted",
        });
    });

    it("returns 404 when the target user is not a member of the team", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const otherUser = seedUser(ctx, {
            email: "other@basischina.com",
            team_id: null,
        });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(otherUser.id);

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found or not in team",
        });
    });

    it("returns validation error for non-positive user id", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = "0";

        await expect(handler(createEvent())).rejects.toThrow();
    });

    it("returns validation error for non-numeric user id", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = "abc";

        await expect(handler(createEvent())).rejects.toThrow();
    });

    it("allows removing members when hackathon status is not_started", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "not_started" });
        const season = seedSeason(ctx);

        const team = seedTeam(ctx, { name: "PreHack Team", season_id: season.id });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, {
            email: "leaving@basischina.com",
            team_id: team.id,
        });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = String(member.id);

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Removed user from the team" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, member.id)).get();
        expect(updated!.team_id).toBeNull();
    });
});
