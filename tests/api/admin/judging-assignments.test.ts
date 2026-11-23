import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
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
} from "../helpers";
import { adminAuditEvents, judgeAssignments, users } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listAssignments: any;
let createAssignment: any;
let deleteAssignment: any;

beforeAll(async () => {
    setupNitroGlobals();
    listAssignments = (await import("~~/server/api/admin/judging/assignments/index.get")).default;
    createAssignment = (await import("~~/server/api/admin/judging/assignments/index.post")).default;
    deleteAssignment = (await import("~~/server/api/admin/judging/assignments/index.delete"))
        .default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
    const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function seedAssignment(overrides: Record<string, unknown> = {}) {
    return ctx.drizzle
        .insert(judgeAssignments)
        .values({ season_id: 1, judge_user_id: 1, created_at: new Date(), ...overrides } as any)
        .returning()
        .get();
}

describe("GET /api/admin/judging/assignments", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockQueryState.value = {};

        await expect(listAssignments(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("lists active-season assignments with judge identity", async () => {
        const judge = seedUser(ctx, {
            email: "judge@basischina.com",
            name: "Judge One",
            role: "judge",
        });
        const assignment = seedAssignment({
            season_id: 1,
            judge_user_id: judge.id,
            pathway: "junior",
        });
        mockQueryState.value = {};

        const result = await listAssignments(createEvent());

        expect(result.assignments).toEqual([
            {
                id: assignment.id,
                season_id: 1,
                judge_user_id: judge.id,
                pathway: "junior",
                team_id: null,
                created_at: assignment.created_at.toISOString(),
                judge_email: "judge@basischina.com",
                judge_name: "Judge One",
            },
        ]);
    });

    it("narrows to one assignment id and rejects unknown seasons", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const first = seedAssignment({ season_id: 1, judge_user_id: judge.id });
        seedAssignment({ season_id: 1, judge_user_id: judge.id, pathway: "senior" });
        mockQueryState.value = { id: first.id };

        const result = await listAssignments(createEvent());
        expect(result.assignments.map((row: any) => row.id)).toEqual([first.id]);

        mockQueryState.value = { season_id: 99 };
        await expect(listAssignments(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reads a season selected by id", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const assignment = seedAssignment({ season_id: past.id, judge_user_id: judge.id });
        mockQueryState.value = { season_id: past.id };

        const result = await listAssignments(createEvent());

        expect(result.assignments.map((row: any) => row.id)).toEqual([assignment.id]);
    });

    it("rejects an unknown active season", async () => {
        ctx.sqlite.exec("DELETE FROM rubric_versions; DELETE FROM seasons;");
        mockQueryState.value = {};

        await expect(listAssignments(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("POST /api/admin/judging/assignments", () => {
    function judgeAndTeam() {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, { name: "Assigned Team", season_id: 1, pathway: "junior" });
        return { judge, team };
    }

    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockBody.value = { judge_user_id: 1 };

        await expect(createAssignment(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("assigns a judge to a team in the active season and audits it", async () => {
        const { judge, team } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id, team_id: team.id };

        const result = await createAssignment(createEvent());

        expect(result.assignment).toMatchObject({
            season_id: 1,
            judge_user_id: judge.id,
            pathway: null,
            team_id: team.id,
        });
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "judging.assignment.create",
            entity_type: "season",
            entity_id: "1",
            after: { judge_user_id: judge.id, pathway: null, team_id: team.id },
        });
        const promoted = ctx.drizzle.select().from(users).where(eq(users.id, judge.id)).get();
        expect(promoted?.is_judge).toBe(1);
    });

    it("does not promote a judge who already has the local role", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", is_judge: 1 });
        const team = seedTeam(ctx, { season_id: 1 });
        mockBody.value = { judge_user_id: judge.id, team_id: team.id };

        await expect(createAssignment(createEvent())).resolves.toHaveProperty("assignment");
        expect(ctx.drizzle.select().from(users).where(eq(users.id, judge.id)).get()?.is_judge).toBe(
            1,
        );
    });

    it("assigns a judge to a pathway without a team", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id, pathway: "senior" };

        await createAssignment(createEvent());

        expect(ctx.drizzle.select().from(judgeAssignments).all()[0]).toMatchObject({
            pathway: "senior",
            team_id: null,
        });
    });

    it("accepts an explicit null team assignment", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id, team_id: null };

        const result = await createAssignment(createEvent());

        expect(result.assignment.team_id).toBeNull();
    });

    it("uses a season selected by id", async () => {
        const { judge } = judgeAndTeam();
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        mockBody.value = { season_id: past.id, judge_user_id: judge.id };

        const result = await createAssignment(createEvent());

        expect(result.assignment.season_id).toBe(past.id);
    });

    it("rejects an unknown season or judge", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { season_id: 999, judge_user_id: judge.id };
        await expect(createAssignment(createEvent())).rejects.toMatchObject({ statusCode: 404 });

        mockBody.value = { judge_user_id: 999 };
        await expect(createAssignment(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects a team outside the assigned season or an unknown team", async () => {
        const { judge } = judgeAndTeam();
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const foreignTeam = seedTeam(ctx, { name: "Foreign Team", season_id: past.id });

        mockBody.value = { judge_user_id: judge.id, team_id: foreignTeam.id };
        await expect(createAssignment(createEvent())).rejects.toMatchObject({ statusCode: 404 });

        mockBody.value = { judge_user_id: judge.id, team_id: 999 };
        await expect(createAssignment(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects a judge competing in the same season", async () => {
        const team = seedTeam(ctx, { name: "Judge Team", season_id: 1 });
        const judge = seedUser(ctx, {
            email: "player-judge@basischina.com",
            team_id: team.id,
        });
        mockBody.value = { judge_user_id: judge.id };

        await expect(createAssignment(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "A participant competing in this season cannot judge it.",
        });
    });

    it("allows a judge whose team belongs to another season", async () => {
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const pastTeam = seedTeam(ctx, { name: "Past Team", season_id: past.id });
        const judge = seedUser(ctx, {
            email: "past-player@basischina.com",
            team_id: pastTeam.id,
        });
        mockBody.value = { judge_user_id: judge.id };

        await expect(createAssignment(createEvent())).resolves.toHaveProperty("assignment");
    });

    it("rejects a pathway that is not in the season rubric", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id, pathway: "not-a-track" };

        await expect(createAssignment(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "The assignment pathway is not a track in this season's rubric.",
        });
    });

    it("rejects inherited object keys as pathways", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id, pathway: "toString" };

        await expect(createAssignment(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "The assignment pathway is not a track in this season's rubric.",
        });
    });

    it("reports a duplicate assignment as 409", async () => {
        const { judge } = judgeAndTeam();
        mockBody.value = { judge_user_id: judge.id };
        const fakeDrizzle = new Proxy(ctx.drizzle as any, {
            get(target, property) {
                if (property === "transaction") {
                    return async (callback: any) =>
                        callback({
                            select: (...args: any[]) => (ctx.drizzle.select as any)(...args),
                            insert: () => ({
                                values: () => ({
                                    onConflictDoNothing: () => ({
                                        returning: () => Promise.resolve([]),
                                    }),
                                }),
                            }),
                        });
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        await expect(
            createAssignment(createEvent({ context: { drizzle: fakeDrizzle } })),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "Assignment already exists",
        });
        expect(ctx.drizzle.select().from(judgeAssignments).all()).toHaveLength(0);
    });
});

describe("DELETE /api/admin/judging/assignments", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockQueryState.value = { id: 1 };

        await expect(deleteAssignment(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("requires an assignment id", async () => {
        mockQueryState.value = {};

        await expect(deleteAssignment(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "Assignment id is required",
        });
    });

    it("removes an assignment and records the deleted row", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const assignment = seedAssignment({ season_id: 1, judge_user_id: judge.id });
        mockQueryState.value = { id: assignment.id };

        await expect(deleteAssignment(createEvent())).resolves.toEqual({
            message: "Assignment removed",
        });

        expect(ctx.drizzle.select().from(judgeAssignments).all()).toHaveLength(0);
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "judging.assignment.delete",
            entity_type: "season",
            entity_id: "1",
            before: { id: assignment.id, judge_user_id: judge.id },
        });
    });

    it("returns 404 for a missing assignment", async () => {
        mockQueryState.value = { id: 999 };

        await expect(deleteAssignment(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});
