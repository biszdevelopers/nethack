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
import { teams } from "~~/server/database/schema";
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

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    handler = (await import("~~/server/api/teams/[id]/submit.post")).default;
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

function validPayload(overrides: Record<string, unknown> = {}) {
    return {
        pathway: "junior",
        project: {
            name: "Awesome Project",
            description: "This is a really awesome project built over the weekend.",
            demo_url: "https://demo.example.com",
            repo_url: "https://github.com/example/repo",
            video_url: "https://www.youtube.com/watch?v=example",
            sourcing: "No AI tools or models were used.",
        },
        ...overrides,
    };
}

describe("POST /api/teams/:id/submit", () => {
    it("submits a project for the team", async () => {
        const team = seedTeam(ctx, { name: "My Team", pathway: "junior" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Successfully submitted project" });

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.project_submitted).toBe(1);
        expect(updated!.project_name).toBe("Awesome Project");
        expect(updated!.pathway).toBe("junior");
        expect(updated!.project_demo_url).toBe("https://demo.example.com");
        expect(updated!.project_repo_url).toBe("https://github.com/example/repo");
        expect(updated!.project_video_url).toBe("https://www.youtube.com/watch?v=example");
    });

    it("includes sourcing notes when provided", async () => {
        const team = seedTeam(ctx, { name: "Sourcing Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload({
            project: {
                name: "Sourced Project",
                description: "Uses external assets and documents every source in the README.",
                demo_url: "https://demo.example.com",
                repo_url: "https://github.com/example/repo",
                video_url: "https://www.youtube.com/watch?v=example",
                sourcing: "Used icons from FontAwesome",
            },
        });

        await handler(createEvent());

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.sourcing).toBe("Used icons from FontAwesome");
    });

    it("requires the AI-use disclosure", async () => {
        const team = seedTeam(ctx, { name: "No Sourcing Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload({
            project: {
                name: "No Sourcing",
                description: "No external assets were used anywhere in this project.",
                demo_url: "https://demo.example.com",
                repo_url: "https://github.com/example/repo",
                video_url: "https://www.youtube.com/watch?v=example",
            },
        });

        await expect(handler(createEvent())).rejects.toThrow();

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.project_submitted).toBe(0);
    });

    it("returns 403 when user is not a team member", async () => {
        const team = seedTeam(ctx, { name: "Other Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: null });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot submit other projects",
        });
    });

    it("returns 403 when hackathon has finished", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "finished" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "My Team", pathway: "junior" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot submit project when hackathon is finished",
        });
    });

    it("returns 403 when hackathon status is voting", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "voting" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Voting Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot submit project when hackathon is finished",
        });
    });

    it("returns 403 with the paused message while the event is paused", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "paused" });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Paused Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("returns 403 with the closed message once the deadline has passed", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "in_progress", end_timestamp: Date.now() - 60_000 });
        seedSeason(ctx);

        const team = seedTeam(ctx, { name: "Late Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot submit project after submissions close",
        });
    });

    it("returns 400 for a track that is not in the season rubric", async () => {
        const team = seedTeam(ctx, { name: "Off-track Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload({ pathway: "unlisted" });

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "Choose a track that is available for this season.",
        });
    });

    it("returns 404 when team is not found", async () => {
        const originalGetUser = globalThis.getUser;
        vi.stubGlobal(
            "getUser",
            vi.fn().mockResolvedValueOnce({ id: 1, team_id: 9999, role: "participant" }),
        );

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "9999";
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Team not found or not accessible currently",
        });

        vi.stubGlobal("getUser", originalGetUser);
    });

    it("returns 409 when project is already submitted", async () => {
        const team = seedTeam(ctx, {
            name: "Submitted Team",
            project_submitted: 1,
            project_name: "Existing",
        });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Project is already submitted",
        });
    });

    it("returns 409 when the team is no longer competing", async () => {
        const team = seedTeam(ctx, { name: "Withdrawn Team", status: "withdrawn" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "This team is no longer competing",
        });
    });

    it("does not overwrite a project submitted between the guard and the write", async () => {
        const team = seedTeam(ctx, { name: "Race Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });
        ctx.drizzle
            .update(teams)
            .set({ project_submitted: 1, project_name: "Locked" })
            .where(eq(teams.id, team.id))
            .run();

        const getTeamSpy = vi
            .spyOn(globalThis as any, "getTeam")
            .mockResolvedValue({ ...team, project_submitted: 0 });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        try {
            await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
            const after = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(after!.project_name).toBe("Locked");
        } finally {
            getTeamSpy.mockRestore();
        }
    });

    it("validates request body through SubmitTeamRequest schema", async () => {
        const team = seedTeam(ctx, { name: "Validation Team" });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            project: {
                name: "No Pathway",
                description: "Missing pathway field.",
                demo_url: "https://demo.example.com",
                repo_url: "https://github.com/example/repo",
                video_url: "https://www.youtube.com/watch?v=example",
                sourcing: "No AI tools or models were used.",
            },
        };

        await expect(handler(createEvent())).rejects.toThrow();
    });

    it("allows submission when hackathon status is not_started", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "not_started" });
        const season = seedSeason(ctx);

        const team = seedTeam(ctx, {
            name: "Early Team",
            season_id: season.id,
        });
        seedUser(ctx, { email: "user@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = validPayload();

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Successfully submitted project" });
    });
});
