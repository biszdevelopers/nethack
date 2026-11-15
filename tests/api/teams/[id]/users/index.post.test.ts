import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
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
} from "../../../helpers";
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
    vi.stubGlobal("getUserByEmail", usersDb.getUserByEmail);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("addTeamMember", membersDb.addTeamMember);

    handler = (await import("~~/server/api/teams/[id]/users/index.post")).default;
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

describe("POST /api/teams/:id/users", () => {
    it("adds a user to the team by email", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", name: "Owner", team_id: team.id });
        const newMember = seedUser(ctx, {
            email: "newbie@basischina.com",
            name: "Newbie",
            team_id: null,
        });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Added user to the team" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, newMember.id)).get();
        expect(updated!.team_id).toBe(team.id);
    });

    it("returns 404 for a team from a previous season", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past", is_active: 0 });
        const staleTeam = seedTeam(ctx, { name: "Old team", season_id: pastSeason.id });
        const owner = seedUser(ctx, {
            email: "owner@basischina.com",
            name: "Owner",
            team_id: staleTeam.id,
        });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(staleTeam.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 when target user is not found", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "nobody@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found",
        });
    });

    it("returns 403 when current user is not a team member", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const otherTeam = seedTeam(ctx, { name: "Other Team" });
        seedUser(ctx, { email: "outsider@basischina.com", team_id: otherTeam.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members to other teams",
        });
    });

    it("returns 403 when hackathon has finished", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "finished" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members after hackathon has finished",
        });
    });

    it("returns 403 when hackathon status is voting", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "voting" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Voting Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members after hackathon has finished",
        });
    });

    it("returns 403 when project is already submitted", async () => {
        const team = seedTeam(ctx, { name: "Team", project_submitted: 1 });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members after project is submitted",
        });
    });

    it("validates request body through AddTeamMemberRequest schema", async () => {
        const originalReadValidatedBody = globalThis.readValidatedBody;
        vi.stubGlobal("readValidatedBody", async (_event: any, schema: any) => {
            const validate = typeof schema === "function" ? schema : schema.parse;
            return validate(mockBody.value);
        });

        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {};

        await expect(handler(createEvent())).rejects.toThrow();

        vi.stubGlobal("readValidatedBody", originalReadValidatedBody);
    });

    it("returns 404 when addTeamMember fails (user already in a team)", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const otherTeam = seedTeam(ctx, { name: "Other Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        seedUser(ctx, {
            email: "taken@basischina.com",
            name: "Taken",
            team_id: otherTeam.id,
        });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "taken@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found or already in a team",
        });
    });

    it("allows adding members when hackathon status is not_started", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "not_started" });
        const season = seedSeason(ctx);

        const team = seedTeam(ctx, { name: "PreHack Team", season_id: season.id });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const newMember = seedUser(ctx, {
            email: "early@basischina.com",
            name: "Early",
            team_id: null,
        });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "early@basischina.com" };

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Added user to the team" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, newMember.id)).get();
        expect(updated!.team_id).toBe(team.id);
    });
});
