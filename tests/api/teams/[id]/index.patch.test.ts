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
} from "../../helpers";
import { teams, users } from "~~/server/database/schema";
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
    vi.stubGlobal("updateTeam", teamsDb.updateTeam);
    vi.stubGlobal("updateTeamPartial", teamsDb.updateTeamPartial);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    handler = (await import("~~/server/api/teams/[id]/index.patch")).default;
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

describe("PATCH /api/teams/:id", () => {
    it("returns 403 when the hackathon has finished", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "finished" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Locked Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "New Name" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot edit team and project after hackathon has finished",
        });
    });

    it("updates the team pathway", async () => {
        const team = seedTeam(ctx, { name: "Pathway Team", pathway: null });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { pathway: "senior" };

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Updated your team & project" });

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.pathway).toBe("senior");
    });

    it("updates project sourcing notes", async () => {
        const team = seedTeam(ctx, { name: "Sourcing Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            project: {
                sourcing: "Used open-source assets from example.com",
            },
        };

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Updated your team & project" });

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.sourcing).toBe("Used open-source assets from example.com");
    });

    it("accepts an empty patch without touching the team", async () => {
        const team = seedTeam(ctx, {
            name: "Untouched Team",
            project_description: "Do not change this",
        });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {};

        await expect(handler(createEvent())).resolves.toEqual({
            message: "Updated your team & project",
        });
        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.name).toBe("Untouched Team");
        expect(updated!.project_description).toBe("Do not change this");
    });

    it("preserves fields that were not supplied by the editor", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, {
            name: "Partial Team",
            project_description: "A description saved by a teammate",
            project_name: "Kept project",
            owner_user_id: user.id,
        });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, user.id)).run();

        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "Renamed Partial Team" };

        await handler(createEvent());

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.name).toBe("Renamed Partial Team");
        expect(updated!.project_description).toBe("A description saved by a teammate");
        expect(updated!.project_name).toBe("Kept project");
    });

    it("rejects a rename that duplicates another team in the season", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Original Name", owner_user_id: user.id });
        seedTeam(ctx, { name: "Taken Name" });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, user.id)).run();

        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "Taken Name" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "A team with that name already exists in this season",
        });
    });

    it("lets a non-owner member edit the project but not rename the team", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Owned Team", owner_user_id: owner.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();

        mockSession.value = { user: { id: member.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "Member Rename" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can rename the team",
        });

        mockBody.value = { project: { name: "Member Project" } };
        await expect(handler(createEvent())).resolves.toEqual({
            message: "Updated your team & project",
        });
        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.project_name).toBe("Member Project");
        expect(updated!.name).toBe("Owned Team");
    });

    it("persists the demonstration video URL", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Video Team", owner_user_id: user.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, user.id)).run();

        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            project: { video_url: "https://www.youtube.com/watch?v=example" },
        };

        await handler(createEvent());

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.project_video_url).toBe("https://www.youtube.com/watch?v=example");
    });

    it("rejects a video URL with credentials", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Bad Video Team", owner_user_id: user.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, user.id)).run();

        const originalReadValidatedBody = globalThis.readValidatedBody;
        vi.stubGlobal("readValidatedBody", async (_event: any, schema: any) => {
            const validate = typeof schema === "function" ? schema : schema.parse;
            return validate(mockBody.value);
        });

        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { project: { video_url: "https://user:pass@example.com/video" } };

        await expect(handler(createEvent())).rejects.toThrow();
        vi.stubGlobal("readValidatedBody", originalReadValidatedBody);
    });

    it("rejects editing a team that belongs to a previous season", async () => {
        const past = seedSeason(ctx, { name: "Past Patch Season", is_active: 0 });
        const team = seedTeam(ctx, {
            name: "Archived Team",
            season_id: past.id,
        });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "Attempted Rename" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Team not found",
        });
    });
});
