import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockParams,
    mockQueryState,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { eq } from "drizzle-orm";
import { hackathon } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listTeams: any;
let getTeamHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", vi.fn(seasonsDb.getActiveSeason));
    vi.stubGlobal("getScoreRankVisibilityResolver", async () => () => ({
        resultsPublished: false,
        showScores: false,
        showRanking: false,
    }));

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getSubmittedUnjudgedTeams", teamsDb.getSubmittedUnjudgedTeams);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwards", awardsDb.getAwards);
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);

    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    listTeams = (await import("~~/server/api/teams/index.get")).default;
    getTeamHandler = (await import("~~/server/api/teams/[id]/index.get")).default;
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
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

describe("GET /api/teams judging queue without an active season", () => {
    beforeEach(() => {
        ctx.sqlite.exec("DELETE FROM rubric_versions; DELETE FROM seasons;");
        ctx.drizzle.update(hackathon).set({ judging_open: 1 }).where(eq(hackathon.id, 1)).run();
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        mockSession.value = { user: { id: judge.id } };
    });

    it("returns an empty paged queue", async () => {
        mockQueryState.value = { judging: "true", page: 1, page_size: 10 };

        await expect(listTeams(createEvent())).resolves.toEqual({
            items: [],
            page: 1,
            page_size: 10,
            total: 0,
            total_pages: 0,
        });
    });

    it("returns an empty unpaged queue", async () => {
        mockQueryState.value = { judging: "true" };

        await expect(listTeams(createEvent())).resolves.toEqual([]);
    });
});

describe("GET /api/teams judging queue pagination defaults", () => {
    beforeEach(() => {
        ctx.drizzle.update(hackathon).set({ judging_open: 1 }).where(eq(hackathon.id, 1)).run();
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        mockSession.value = { user: { id: judge.id } };
    });

    it("defaults the page number while honouring an explicit page size", async () => {
        seedTeam(ctx, { name: "Project", project_submitted: 1 });
        mockQueryState.value = { judging: "true", page_size: 1 };

        const result = await listTeams(createEvent());

        expect(result).toMatchObject({
            page: 1,
            page_size: 1,
            total: 1,
            total_pages: 1,
        });
        expect(result.items).toHaveLength(1);
    });

    it("defaults the page size while honouring an explicit page", async () => {
        seedTeam(ctx, { name: "Project", project_submitted: 1 });
        mockQueryState.value = { judging: "true", page: 1 };

        await expect(listTeams(createEvent())).resolves.toMatchObject({
            page: 1,
            page_size: 20,
        });
    });

    it("returns an empty page past the end of the queue", async () => {
        seedTeam(ctx, { name: "Project", project_submitted: 1 });
        mockQueryState.value = { judging: "true", page: 5, page_size: 10 };

        const result = await listTeams(createEvent());

        expect(result).toMatchObject({ items: [], total: 1, total_pages: 1 });
    });

    it("reports zero pages when the season has no submitted projects", async () => {
        mockQueryState.value = { judging: "true", page: 1, page_size: 10 };

        await expect(listTeams(createEvent())).resolves.toMatchObject({
            items: [],
            total: 0,
            total_pages: 0,
        });
    });

    it("keeps an unfiltered page when the cached event state has no season", async () => {
        // Simulate the narrow window where the page branch resolves a season
        // but the request-scoped event state was computed without one.
        ctx.sqlite.exec("DELETE FROM rubric_versions; DELETE FROM seasons;");
        vi.mocked(globalThis.getActiveSeason).mockImplementationOnce(() =>
            Promise.resolve({ id: 1 } as unknown as Season),
        );
        mockQueryState.value = { judging: "true", page: 1, page_size: 10 };

        const result = await listTeams(createEvent());

        expect(result).toMatchObject({ page: 1, page_size: 10, total: 0 });
    });
});

describe("GET /api/teams public gallery gating", () => {
    it("shows an open-season project only to its own members", async () => {
        const own = seedTeam(ctx, { name: "Own Project", project_submitted: 1 });
        const other = seedTeam(ctx, { name: "Other Project", project_submitted: 1 });
        const viewer = seedUser(ctx, { email: "viewer@basischina.com", team_id: own.id });
        mockSession.value = { user: { id: viewer.id } };
        mockQueryState.value = {};

        const result = await listTeams(createEvent());

        expect(result.map((team: any) => team.id)).toEqual([own.id]);
        expect(result.map((team: any) => team.id)).not.toContain(other.id);
    });

    it("hides every draft from a viewer without a team", async () => {
        seedTeam(ctx, { name: "Draft One", project_submitted: 1 });
        seedTeam(ctx, { name: "Draft Two", project_submitted: 1 });
        const viewer = seedUser(ctx, { email: "viewer@basischina.com" });
        mockSession.value = { user: { id: viewer.id } };
        mockQueryState.value = {};

        await expect(listTeams(createEvent())).resolves.toEqual([]);
    });

    it("hides every draft from an archived-team pointer", async () => {
        seedTeam(ctx, { name: "Draft", project_submitted: 1 });
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const archived = seedTeam(ctx, { name: "Archived", season_id: past.id });
        const viewer = seedUser(ctx, { email: "viewer@basischina.com", team_id: archived.id });
        mockSession.value = { user: { id: viewer.id } };
        mockQueryState.value = {};

        await expect(listTeams(createEvent())).resolves.toEqual([]);
    });

    it("shows every draft to judging staff", async () => {
        const first = seedTeam(ctx, { name: "First", project_submitted: 1 });
        const second = seedTeam(ctx, { name: "Second", project_submitted: 1 });
        mockQueryState.value = {};

        const result = await listTeams(
            createEvent({
                context: {
                    drizzle: ctx.drizzle,
                    oauth2: { permissions: ["nethack.Judging.assignmentsRead"] },
                },
            }),
        );

        expect(result.map((team: any) => team.id)).toEqual([first.id, second.id]);
    });

    it("returns a historical archive without the active-season gate", async () => {
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const archived = seedTeam(ctx, {
            name: "Archived",
            season_id: past.id,
            project_submitted: 1,
        });
        seedTeam(ctx, { name: "Current", project_submitted: 1 });
        mockQueryState.value = { season_id: past.id };

        const result = await listTeams(createEvent());

        expect(result.map((team: any) => team.id)).toEqual([archived.id]);
    });

    it("supports keyset pagination once the gallery is public", async () => {
        ctx.drizzle.update(hackathon).set({ status: "voting" }).where(eq(hackathon.id, 1)).run();
        const first = seedTeam(ctx, { name: "First", project_submitted: 1 });
        const second = seedTeam(ctx, { name: "Second", project_submitted: 1 });
        mockQueryState.value = { limit: 1, after: first.id };

        const result = await listTeams(createEvent());

        expect(result.items.map((team: any) => team.id)).toEqual([second.id]);
        expect(result.next_cursor).toBe(second.id);
    });
});

describe("GET /api/teams/:id detail gating", () => {
    it("returns 404 for an unknown team", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 999 };

        await expect(getTeamHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("hides an unsubmitted project from an anonymous visitor", async () => {
        const draft = seedTeam(ctx, { name: "Draft", project_submitted: 0 });
        mockSession.value = undefined;
        mockParams.values = { id: draft.id };

        await expect(getTeamHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("hides a draft after submissions close from a non-member", async () => {
        const draft = seedTeam(ctx, { name: "Draft", project_submitted: 0 });
        ctx.drizzle.update(hackathon).set({ status: "voting" }).where(eq(hackathon.id, 1)).run();
        mockSession.value = undefined;
        mockParams.values = { id: draft.id };

        await expect(getTeamHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("shows an unsubmitted project to a signed-in member", async () => {
        const draft = seedTeam(ctx, { name: "Draft", project_submitted: 0 });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: draft.id });
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: draft.id };

        const result = await getTeamHandler(createEvent());

        expect(result).toMatchObject({ id: draft.id });
    });

    it("shows an unsubmitted project to judging staff", async () => {
        const draft = seedTeam(ctx, { name: "Draft", project_submitted: 0 });
        mockSession.value = undefined;
        mockParams.values = { id: draft.id };

        const result = await getTeamHandler(
            createEvent({
                context: {
                    drizzle: ctx.drizzle,
                    oauth2: { permissions: ["nethack.Judging.resultsRead"] },
                },
            }),
        );

        expect(result).toMatchObject({ id: draft.id });
    });

    it("uses a null viewer team for a user with no team", async () => {
        const submitted = seedTeam(ctx, { name: "Public", project_submitted: 1 });
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: submitted.id };

        await expect(getTeamHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});
