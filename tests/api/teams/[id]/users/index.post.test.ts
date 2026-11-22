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
import { eq } from "drizzle-orm";
import { teamInvites, users } from "~~/server/database/schema";

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
    vi.stubGlobal("getTeamMembers", membersDb.getTeamMembers);
    vi.stubGlobal("getTeamInvites", membersDb.getTeamInvites);
    vi.stubGlobal("createTeamInvite", membersDb.createTeamInvite);

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
    it("creates a pending invitation instead of adding the user", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com", name: "Owner" });
        const team = seedTeam(ctx, { name: "Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        const invitee = seedUser(ctx, {
            email: "newbie@basischina.com",
            name: "Newbie",
            team_id: null,
        });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        const response = await handler(createEvent());
        expect(response).toMatchObject({ message: "Invitation sent" });
        expect(response.email).toBe("newbie@basischina.com");
        expect(response.token).toMatch(/^[a-f0-9]{64}$/);
        expect(response.invite_url).toBe(`/dashboard/teams?invite=${response.token}`);
        expect(response.expires_at).toEqual(expect.any(String));

        const stored = ctx.drizzle.select().from(teamInvites).get()!;
        expect(stored).toMatchObject({
            team_id: team.id,
            email: "newbie@basischina.com",
        });
        // Only the digest is persisted; the raw token was returned once.
        expect(stored.token).not.toBe(response.token);
        expect(stored.token).toMatch(/^[a-f0-9]{64}$/);
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, invitee.id)).get()!.team_id,
        ).toBeNull();
    });

    it("rejects invitations from a team that is no longer active", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com", name: "Owner" });
        const team = seedTeam(ctx, {
            name: "Withdrawn",
            owner_user_id: owner.id,
            status: "withdrawn",
        });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        seedUser(ctx, { email: "newbie@basischina.com", name: "Newbie", team_id: null });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            message: "This team is no longer accepting members",
        });
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(0);
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

    it("invites an email without an account only when unclaimed invitations are allowed", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "nobody@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message:
                "No account exists for that email yet. Confirm the address, or allow an unclaimed invitation.",
        });

        mockBody.value = { email: "nobody@basischina.com", allowUnclaimed: true };
        await expect(handler(createEvent())).resolves.toMatchObject({
            message: "Invitation sent",
        });
    });

    it("lets only the owner invite members", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: member.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can invite members",
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

        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot invite members after the hackathon has finished",
        });
    });

    it("returns 403 when hackathon status is voting", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "voting" });
        seedSeason(ctx);

        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Voting Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot invite members after the hackathon has finished",
        });
    });

    it("returns 403 when project is already submitted", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, {
            name: "Team",
            project_submitted: 1,
            owner_user_id: owner.id,
        });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "newbie@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot invite members after the project is submitted",
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

    it("returns 409 when the target is already in a team", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Team", owner_user_id: owner.id });
        const otherTeam = seedTeam(ctx, { name: "Other Team" });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        seedUser(ctx, {
            email: "taken@basischina.com",
            name: "Taken",
            team_id: otherTeam.id,
        });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "taken@basischina.com" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "That user is already in a team",
        });
    });

    it("allows invitations when hackathon status is not_started", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "not_started" });
        const season = seedSeason(ctx);

        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, {
            name: "PreHack Team",
            season_id: season.id,
            owner_user_id: owner.id,
        });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "early@basischina.com", allowUnclaimed: true };

        await expect(handler(createEvent())).resolves.toMatchObject({
            message: "Invitation sent",
        });
    });
});
