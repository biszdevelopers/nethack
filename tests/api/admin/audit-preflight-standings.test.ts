import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockQueryState,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedTeamEvaluations,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { adminAuditEvents, awards, seasons, teamAwards } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let auditHandler: any;
let preflightHandler: any;
let standingsHandler: any;
const setResponseHeader = vi.fn();

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("setResponseHeader", setResponseHeader);
    auditHandler = (await import("~~/server/api/admin/audit.get")).default;
    preflightHandler = (await import("~~/server/api/admin/preflight.get")).default;
    standingsHandler = (await import("~~/server/api/admin/standings.csv.get")).default;
});

beforeEach(async () => {
    resetMockState();
    setResponseHeader.mockReset();
    ctx = await createTestContext();
    const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function seedAuditEvent(overrides: Record<string, unknown> = {}) {
    return ctx.drizzle
        .insert(adminAuditEvents)
        .values({
            action: "test.action",
            entity_type: "team",
            entity_id: "1",
            before: null,
            after: null,
            reason: null,
            request_id: null,
            created_at: new Date(),
            ...overrides,
        } as any)
        .returning()
        .get();
}

describe("GET /api/admin/audit", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;

        await expect(auditHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects a user without the audit permission", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(auditHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns the newest events with parsed audit fields", async () => {
        seedAuditEvent({
            action: "team.reopen",
            entity_type: "team",
            entity_id: "5",
            before: { project_submitted: 1 },
            after: { project_submitted: 0 },
            reason: "mistaken submission",
            request_id: "req-1",
        });
        const newest = seedAuditEvent({
            action: "season.create",
            entity_type: "season",
            entity_id: "9",
        });
        mockQueryState.value = { limit: 50 };

        const result = await auditHandler(createEvent());

        expect(result.events.map((event: any) => event.id)).toEqual([newest.id, newest.id - 1]);
        expect(result.events[1]).toMatchObject({
            actor_user_id: null,
            action: "team.reopen",
            entity_type: "team",
            entity_id: "5",
            before: { project_submitted: 1 },
            after: { project_submitted: 0 },
            reason: "mistaken submission",
            request_id: "req-1",
        });
        expect(result.events[0].before).toBeNull();
        expect(result.events[0].after).toBeNull();
        expect(new Date(result.events[0].created_at).toISOString()).toBe(
            result.events[0].created_at,
        );
    });

    it("honours the row limit", async () => {
        seedAuditEvent();
        seedAuditEvent();
        mockQueryState.value = { limit: 1 };

        const result = await auditHandler(createEvent());

        expect(result.events).toHaveLength(1);
    });

    it("filters by season through season rows and matching payloads", async () => {
        const direct = seedAuditEvent({
            action: "season.update",
            entity_type: "season",
            entity_id: "5",
        });
        seedAuditEvent({
            action: "hackathon.update",
            entity_type: "season",
            entity_id: "live",
            after: { season_id: 5 },
        });
        seedAuditEvent({ action: "other", entity_type: "season", entity_id: "6" });
        mockQueryState.value = { limit: 50, season_id: 5 };

        const result = await auditHandler(createEvent());

        expect(result.events.map((event: any) => event.id)).toEqual([direct.id]);
    });

    it("returns an empty list when no event matches the season", async () => {
        seedAuditEvent({ entity_type: "season", entity_id: "1" });
        mockQueryState.value = { limit: 50, season_id: 42 };

        await expect(auditHandler(createEvent())).resolves.toEqual({ events: [] });
    });
});

describe("GET /api/admin/preflight", () => {
    function seedEvaluatedSeason() {
        seedHackathon(ctx, { status: "finished", end_timestamp: 0 });
        const season = seedSeason(ctx, {
            status: "finished",
            results_published: 0,
            max_votes_per_user: 0,
            start_timestamp: 100,
            end_timestamp: 0,
            voting_start_timestamp: 300,
            voting_end_timestamp: 200,
        });
        const junior = seedTeam(ctx, {
            name: "Junior One",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        const senior = seedTeam(ctx, {
            name: "Senior One",
            pathway: "senior",
            season_id: season.id,
            project_submitted: 1,
        });
        seedTeam(ctx, {
            name: "Junior Two",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        seedTeam(ctx, {
            name: "Junior Three",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        const withdrawn = seedTeam(ctx, {
            name: "Withdrawn One",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
            status: "withdrawn",
        });
        seedTeam(ctx, { name: "Draft", season_id: season.id, project_submitted: 0 });
        seedTeamEvaluations(ctx, junior, 4);
        seedTeamEvaluations(ctx, senior, 1);
        return { season, junior, senior, withdrawn };
    }

    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;

        await expect(preflightHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("reports the active season readiness and data mismatches", async () => {
        const { season } = seedEvaluatedSeason();
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        ctx.drizzle
            .insert((await import("~~/server/database/schema")).judgeAssignments)
            .values({ season_id: season.id, judge_user_id: judge.id })
            .run();
        mockQueryState.value = {};

        const result = await preflightHandler(createEvent());

        expect(result).toMatchObject({
            season_id: season.id,
            submitted_teams: 5,
            // Junior (4 evaluations) is fine; senior (1) and the three
            // unevaluated projects fall below the three-reviewer threshold.
            teams_below_minimum_evaluations: 4,
            evaluations_total: 5,
            judges_with_evaluations: 5,
            assigned_judges: 1,
            mismatches: {
                finished_without_results: 1,
                published_without_timestamp: 0,
                missing_event_end: 1,
                invalid_date_range: 1,
            },
            vote_cap: {
                max_votes_per_user: 0,
                max_eligible_projects: 2,
                feasible: true,
            },
        });
        expect(result.gates).toMatchObject({
            submissions_open: false,
            voting_open: false,
            judging_open: false,
            gallery_public: true,
            results_visible: false,
        });
    });

    it("reports a published season without a timestamp and an infeasible vote cap", async () => {
        seedHackathon(ctx, { status: "voting", results_published: 1 });
        const season = seedSeason(ctx, {
            status: "in_progress",
            results_published: 1,
            results_published_at: null,
            max_votes_per_user: 1,
            start_timestamp: 10,
            end_timestamp: 20,
            voting_start_timestamp: 10,
            voting_end_timestamp: 20,
        });
        seedTeam(ctx, {
            name: "Only Project",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        mockQueryState.value = {};

        const result = await preflightHandler(createEvent());

        expect(result.mismatches).toEqual({
            finished_without_results: 0,
            published_without_timestamp: 1,
            missing_event_end: 0,
            invalid_date_range: 0,
        });
        expect(result.vote_cap).toEqual({
            max_votes_per_user: 1,
            max_eligible_projects: 0,
            feasible: false,
        });
    });

    it("rejects an inactive vote cap below the five-star minimum", async () => {
        seedHackathon(ctx);
        const season = seedSeason(ctx, { max_votes_per_user: 1 });
        seedTeam(ctx, { name: "A", pathway: "junior", season_id: season.id, project_submitted: 1 });
        seedTeam(ctx, { name: "B", pathway: "junior", season_id: season.id, project_submitted: 1 });
        seedTeam(ctx, { name: "C", pathway: "junior", season_id: season.id, project_submitted: 1 });
        mockQueryState.value = {};

        const result = await preflightHandler(createEvent());

        expect(result.vote_cap.feasible).toBe(false);
    });

    it("reads a season selected by id and rejects unknown seasons", async () => {
        seedHackathon(ctx);
        const active = seedSeason(ctx);
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        mockQueryState.value = { season_id: past.id };

        const result = await preflightHandler(createEvent());
        expect(result.season_id).toBe(past.id);

        mockQueryState.value = { season_id: 404 };
        await expect(preflightHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
        expect(active.id).not.toBe(past.id);
    });

    it("rejects a request when no season is active", async () => {
        seedHackathon(ctx);
        mockQueryState.value = {};

        await expect(preflightHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("treats missing aggregate rows as empty counts", async () => {
        const seasonRow = {
            id: 5,
            status: "not_started",
            results_published: 0,
            results_published_at: null,
            max_votes_per_user: 0,
            start_timestamp: 0,
            end_timestamp: 0,
            voting_start_timestamp: 0,
            voting_end_timestamp: 0,
        };
        const fakeDrizzle = {
            select: () => ({
                from: (table: unknown) => {
                    const query: any = {
                        where: () => query,
                        groupBy: () => query,
                        orderBy: () => query,
                        limit: () => Promise.resolve(table === seasons ? [seasonRow] : []),
                        then: (resolve: any) => resolve([]),
                    };
                    return query;
                },
            }),
        };
        mockQueryState.value = { season_id: seasonRow.id };
        vi.mocked(globalThis.requireUser).mockResolvedValueOnce({ id: 1 } as any);

        const result = await preflightHandler(createEvent({ context: { drizzle: fakeDrizzle } }));

        expect(result).toEqual({
            season_id: seasonRow.id,
            submitted_teams: 0,
            teams_below_minimum_evaluations: 0,
            evaluations_total: 0,
            judges_with_evaluations: 0,
            assigned_judges: 0,
            mismatches: {
                finished_without_results: 0,
                published_without_timestamp: 0,
                missing_event_end: 1,
                invalid_date_range: 0,
            },
            vote_cap: {
                max_votes_per_user: 0,
                max_eligible_projects: 0,
                feasible: false,
            },
            gates: {
                submissions_open: false,
                voting_open: false,
                judging_open: false,
                gallery_public: false,
                results_visible: false,
            },
        });
    });
});

describe("GET /api/admin/standings.csv", () => {
    function seedStandings() {
        seedHackathon(ctx, { status: "voting" });
        const season = seedSeason(ctx);
        const first = seedTeam(ctx, {
            name: 'Team "Alpha", One',
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
            project_name: "Line one\nline two",
            project_demo_url: "https://demo.example.test/?q=1,2",
            project_repo_url: null,
        });
        const second = seedTeam(ctx, {
            name: "Team Beta",
            pathway: "senior",
            season_id: season.id,
            project_submitted: 1,
            project_name: "Beta",
            project_demo_url: null,
            project_repo_url: "https://repo.example.test/beta",
        });
        seedTeam(ctx, {
            name: "Not submitted",
            season_id: season.id,
            project_submitted: 0,
        });
        ctx.drizzle
            .insert(awards)
            .values({
                namespace: "gold",
                name: "Gold",
                description: "First place",
                icon: "trophy",
                color: "gold",
            })
            .run();
        ctx.drizzle
            .insert(awards)
            .values({
                namespace: "best-design",
                name: "Best Design",
                description: "Design",
                icon: "sparkles",
                color: "blue",
            })
            .run();
        ctx.drizzle
            .insert(teamAwards)
            .values([
                { team_id: first.id, award: "gold", meta: "{}" },
                { team_id: first.id, award: "best-design", meta: "{}" },
            ])
            .run();
        return { season, first, second };
    }

    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;

        await expect(standingsHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("streams a CSV with escaped cells, awards, and attachment headers", async () => {
        const { season, first, second } = seedStandings();
        mockQueryState.value = {};

        const csv = await standingsHandler(createEvent());
        const lines = csv.trimEnd().split("\n");

        expect(lines[0]).toBe(
            "team_id,team,pathway,status,score_exact,score,rank,awards,project_name,demo_url,repo_url",
        );
        expect(csv).toContain(
            `${first.id},"Team ""Alpha"", One",junior,active,0,0,1,Gold; Best Design,"Line one`,
        );
        expect(csv).toContain(
            `${second.id},Team Beta,senior,active,0,0,1,,Beta,,https://repo.example.test/beta`,
        );
        expect(csv.endsWith("\n")).toBe(true);
        expect(setResponseHeader).toHaveBeenCalledWith(
            expect.anything(),
            "content-type",
            "text/csv; charset=utf-8",
        );
        expect(setResponseHeader).toHaveBeenCalledWith(
            expect.anything(),
            "content-disposition",
            `attachment; filename="standings-season-${season.id}.csv"`,
        );
    });

    it("uses the requested season and returns 404 when it does not exist", async () => {
        seedHackathon(ctx);
        const season = seedSeason(ctx);
        seedTeam(ctx, {
            name: "Cursor Team",
            season_id: season.id,
            project_submitted: 1,
        });
        mockQueryState.value = { season_id: season.id };

        const csv = await standingsHandler(createEvent());
        expect(csv).toContain("Cursor Team");

        mockQueryState.value = { season_id: 999 };
        await expect(standingsHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 when no season is active", async () => {
        ctx.sqlite.exec("DELETE FROM rubric_versions; DELETE FROM seasons;");
        mockQueryState.value = {};

        await expect(standingsHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("serves the active season standings after the 404 paths", async () => {
        seedHackathon(ctx);
        const season = seedSeason(ctx);
        seedTeam(ctx, {
            name: "Final Team",
            season_id: season.id,
            project_submitted: 1,
        });
        mockQueryState.value = {};

        const csv = await standingsHandler(createEvent());

        expect(csv).toContain("Final Team");
    });
});
