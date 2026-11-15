import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
    createTestContext,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    mockBody,
    mockParams,
    mockQueryState,
    mockSession,
    type TestContext,
} from "./helpers";
import { hackathon, seasons, teams } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60_000 },
}));

let ctx: TestContext;
let listTeams: any;
let updateTeam: any;
let submitTeam: any;
let updateHackathon: any;

beforeAll(async () => {
    setupNitroGlobals();
    const validate = (schema: any, value: unknown) =>
        typeof schema === "function" ? schema(value) : schema.parse(value);
    vi.stubGlobal("getValidatedQuery", (_event: unknown, schema: any) =>
        validate(schema, mockQueryState.value),
    );
    vi.stubGlobal("readValidatedBody", async (_event: unknown, schema: any) =>
        validate(schema, mockBody.value),
    );

    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getAllTeams", teamsDb.getAllTeams);
    vi.stubGlobal("getSubmittedUnjudgedTeams", teamsDb.getSubmittedUnjudgedTeams);
    vi.stubGlobal("getTeamsBySeason", teamsDb.getTeamsBySeason);
    vi.stubGlobal("updateTeam", teamsDb.updateTeam);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);
    vi.stubGlobal("getScoreRankVisibilityResolver", seasonsDb.getScoreRankVisibilityResolver);
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);
    vi.stubGlobal("getAwards", awardsDb.getAwards);

    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    listTeams = (await import("~~/server/api/teams/index.get")).default;
    updateTeam = (await import("~~/server/api/teams/[id]/index.patch")).default;
    submitTeam = (await import("~~/server/api/teams/[id]/submit.post")).default;
    updateHackathon = (await import("~~/server/api/admin/hackathon/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
    const admin = seedUser(ctx, { role: "admin", email: "coverage-admin@basischina.com" });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function event() {
    return { context: { drizzle: ctx.drizzle } };
}

describe("GET /api/teams action edges", () => {
    it("returns an empty paginated judge queue when the season has no active rubric season", async () => {
        ctx.drizzle.update(seasons).set({ is_active: 0 }).where(eq(seasons.id, 1)).run();
        ctx.drizzle
            .update(hackathon)
            .set({ status: "voting", judging_open: 1 })
            .where(eq(hackathon.id, 1))
            .run();
        const judge = seedUser(ctx, { role: "judge", email: "coverage-judge@basischina.com" });
        mockSession.value = { user: { id: judge.id } };
        mockQueryState.value = { judging: "true", page: 3, page_size: 7 };

        await expect(listTeams(event())).resolves.toEqual({
            items: [],
            page: 3,
            page_size: 7,
            total: 0,
            total_pages: 0,
        });
    });

    it("handles a page beyond the final submitted project without evaluation lookups", async () => {
        ctx.drizzle
            .update(hackathon)
            .set({ status: "voting", judging_open: 1 })
            .where(eq(hackathon.id, 1))
            .run();
        const judge = seedUser(ctx, {
            role: "judge",
            email: "coverage-queue-judge@basischina.com",
        });
        seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        mockSession.value = { user: { id: judge.id } };
        mockQueryState.value = { judging: "true", page: 2, page_size: 1 };

        await expect(listTeams(event())).resolves.toMatchObject({
            items: [],
            page: 2,
            page_size: 1,
            total: 1,
            total_pages: 1,
        });
    });

    it("defaults the page when only page_size is supplied", async () => {
        ctx.drizzle
            .update(hackathon)
            .set({ status: "voting", judging_open: 1 })
            .where(eq(hackathon.id, 1))
            .run();
        const judge = seedUser(ctx, { role: "judge", email: "page-size-judge@basischina.com" });
        seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        mockSession.value = { user: { id: judge.id } };
        mockQueryState.value = { judging: "true", page_size: 1 };

        await expect(listTeams(event())).resolves.toMatchObject({
            page: 1,
            page_size: 1,
            total: 1,
            total_pages: 1,
        });
    });

    it("returns zero total pages when the active season has no submissions", async () => {
        ctx.drizzle
            .update(hackathon)
            .set({ status: "voting", judging_open: 1 })
            .where(eq(hackathon.id, 1))
            .run();
        const judge = seedUser(ctx, { role: "judge", email: "empty-queue-judge@basischina.com" });
        mockSession.value = { user: { id: judge.id } };
        mockQueryState.value = { judging: "true", page: 1 };

        await expect(listTeams(event())).resolves.toMatchObject({
            items: [],
            total: 0,
            total_pages: 0,
        });
    });

    it("uses the zero fallback if the database aggregate result has no row", async () => {
        ctx.drizzle
            .update(hackathon)
            .set({ status: "voting", judging_open: 1 })
            .where(eq(hackathon.id, 1))
            .run();
        const judge = seedUser(ctx, { role: "judge", email: "empty-count-judge@basischina.com" });
        mockSession.value = { user: { id: judge.id } };
        mockQueryState.value = { judging: "true", page: 1 };
        const database = ctx.drizzle as any;
        const drizzle = new Proxy(database, {
            get(target, property) {
                if (property === "select") {
                    return (fields?: Record<string, unknown>) => {
                        if (fields && "total" in fields) {
                            return { from: () => ({ where: async () => [] }) };
                        }
                        return target.select(fields);
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        await expect(listTeams({ context: { drizzle } })).resolves.toMatchObject({
            total: 0,
            total_pages: 0,
        });
    });

    it("rejects invalid season and pagination query values", async () => {
        mockQueryState.value = { season_id: 0, page: 0, page_size: 51 };
        await expect(listTeams(event())).rejects.toThrow();
    });
});

describe("PATCH /api/teams/:id action edges", () => {
    it("allows a team member to change track and project fields before the event starts", async () => {
        const team = seedTeam(ctx, { name: "Draft team" });
        const owner = seedUser(ctx, { email: "owner-one@basischina.com", team_id: team.id });
        ctx.drizzle
            .update(hackathon)
            .set({ status: "not_started" })
            .where(eq(hackathon.id, 1))
            .run();
        mockSession.value = { user: { id: owner.id } };
        mockParams.values.id = String(team.id);
        mockBody.value = {
            pathway: "senior",
            project: {
                name: "Project",
                description: "Updated description",
                demo_url: "",
                repo_url: "https://github.com/example/project",
                sourcing: "Original work",
            },
        };

        await expect(updateTeam(event())).resolves.toEqual({
            message: "Updated your team & project",
        });
        const saved = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(saved).toMatchObject({
            pathway: "senior",
            project_name: "Project",
            project_description: "Updated description",
            project_demo_url: null,
            project_repo_url: "https://github.com/example/project",
            sourcing: "Original work",
        });
    });

    it("rejects a track that is valid input but absent from the season rubric", async () => {
        const team = seedTeam(ctx, { name: "Draft team" });
        const owner = seedUser(ctx, { email: "owner-two@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values.id = String(team.id);
        mockBody.value = { pathway: "unconfigured-track" };

        await expect(updateTeam(event())).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects edits after judging starts and malformed project updates", async () => {
        const team = seedTeam(ctx, { name: "Draft team" });
        const owner = seedUser(ctx, { email: "owner-three@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values.id = String(team.id);
        ctx.drizzle.update(hackathon).set({ status: "voting" }).where(eq(hackathon.id, 1)).run();
        mockBody.value = { name: "Still draft" };

        await expect(updateTeam(event())).rejects.toMatchObject({ statusCode: 403 });

        ctx.drizzle
            .update(hackathon)
            .set({ status: "in_progress" })
            .where(eq(hackathon.id, 1))
            .run();
        mockBody.value = { project: { demo_url: "javascript:alert(1)" } };
        await expect(updateTeam(event())).rejects.toThrow();
    });
});

describe("POST /api/teams/:id/submit action edges", () => {
    it("rejects a valid pathway that is not configured in the season rubric", async () => {
        const team = seedTeam(ctx, { name: "Draft team" });
        const owner = seedUser(ctx, { email: "owner-four@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values.id = String(team.id);
        mockBody.value = {
            pathway: "unconfigured-track",
            project: {
                name: "Project",
                description: "A complete project description for validation.",
                demo_url: "https://demo.example.com",
                repo_url: "https://github.com/example/project",
            },
        };

        await expect(submitTeam(event())).rejects.toMatchObject({ statusCode: 400 });
        const unchanged = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(unchanged?.project_submitted).toBe(0);
    });

    it("rejects a malformed submission without persisting partial project data", async () => {
        const team = seedTeam(ctx, { name: "Draft team" });
        const owner = seedUser(ctx, { email: "owner-five@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values.id = String(team.id);
        mockBody.value = {
            pathway: "junior",
            project: { name: "Project", description: "Missing its required links" },
        };

        await expect(submitTeam(event())).rejects.toThrow();
        const unchanged = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(unchanged?.project_submitted).toBe(0);
    });
});

describe("PATCH /api/admin/hackathon action edges", () => {
    it("updates an inactive season without changing the global event settings", async () => {
        const oldSeason = seedSeason(ctx, { name: "Previous season", is_active: 0 });
        const timestamps = {
            start_timestamp: 101,
            end_timestamp: 202,
            voting_start_timestamp: 303,
            voting_end_timestamp: 404,
            results_open_timestamp: 505,
        };
        ctx.drizzle.update(seasons).set(timestamps).where(eq(seasons.id, oldSeason.id)).run();
        ctx.drizzle.update(hackathon).set(timestamps).where(eq(hackathon.id, 1)).run();
        mockBody.value = { season_id: oldSeason.id, show_scores: 1 };

        const result = await updateHackathon(event());
        const savedSeason = ctx.drizzle
            .select()
            .from(seasons)
            .where(eq(seasons.id, oldSeason.id))
            .get();
        const global = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get();
        expect(savedSeason?.show_scores).toBe(1);
        expect(savedSeason).toMatchObject(timestamps);
        expect(global?.show_scores).toBe(0);
        expect(global).toMatchObject(timestamps);
        expect(result.hackathon.show_scores).toBe(0);
    });

    it("preserves omitted timestamps while honoring explicit zero and null clears", async () => {
        const timestamps = {
            start_timestamp: 101,
            end_timestamp: 202,
            voting_start_timestamp: 303,
            voting_end_timestamp: 404,
            results_open_timestamp: 505,
        };
        ctx.drizzle.update(hackathon).set(timestamps).where(eq(hackathon.id, 1)).run();

        mockBody.value = { start_timestamp: 0 };
        await updateHackathon(event());
        let saved = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get();
        expect(saved).toMatchObject({ ...timestamps, start_timestamp: 0 });

        mockBody.value = { end_timestamp: null };
        await updateHackathon(event());
        saved = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get();
        expect(saved).toMatchObject({ ...timestamps, start_timestamp: 0, end_timestamp: 0 });
    });

    it("rejects a season routing hint with no updateable configuration", async () => {
        mockBody.value = { season_id: 1, schedule_start: null };
        await expect(updateHackathon(event())).rejects.toMatchObject({ statusCode: 400 });
    });
});
