import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockParams,
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
import {
    adminAuditEvents,
    awards,
    hackathon,
    teamAwards,
    teamScores,
    teams,
} from "~~/server/database/schema";
import { eq } from "drizzle-orm";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let reopenHandler: any;
let statusHandler: any;
let deleteScoreHandler: any;
let disbandHandler: any;
let transferHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    reopenHandler = (await import("~~/server/api/admin/teams/[id]/reopen.post")).default;
    statusHandler = (await import("~~/server/api/admin/teams/[id]/status.patch")).default;
    deleteScoreHandler = (await import("~~/server/api/admin/teams/[id]/scores/[judgeId].delete"))
        .default;
    disbandHandler = (await import("~~/server/api/teams/[id]/index.delete")).default;
    transferHandler = (await import("~~/server/api/teams/[id]/owner.patch")).default;
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

function seedSubmittedTeam(name = "Submitted Team", overrides: Record<string, unknown> = {}) {
    return ctx.drizzle
        .insert(teams)
        .values({
            name,
            season_id: 1,
            project_submitted: 1,
            submitted_at: new Date("2026-01-01T00:00:00.000Z"),
            rank: 3,
            status: "active",
            ...overrides,
        } as any)
        .returning()
        .get();
}

describe("POST /api/admin/teams/:id/reopen", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1 };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("reopens a submission and audits the change", async () => {
        const team = seedSubmittedTeam();
        mockParams.values = { id: team.id };
        mockBody.value = { reason: "Late edit approved" };

        await expect(reopenHandler(createEvent())).resolves.toEqual({
            message: "Submission reopened",
            team_id: team.id,
        });

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!;
        expect(row.project_submitted).toBe(0);
        expect(row.rank).toBeNull();
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "team.reopen",
            entity_type: "team",
            entity_id: String(team.id),
            before: {
                project_submitted: 1,
                submitted_at: "2026-01-01T00:00:00.000Z",
            },
            after: { project_submitted: 0 },
            reason: "Late edit approved",
        });
    });

    it("refuses to reopen a team that never submitted", async () => {
        const team = seedTeam(ctx, {
            name: "Draft Team",
            season_id: 1,
            project_submitted: 0,
        });
        mockParams.values = { id: team.id };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "This team has not submitted a project to reopen.",
        });
        expect(
            ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!.project_submitted,
        ).toBe(0);
    });

    it("stores a null reason when none is supplied", async () => {
        const team = seedSubmittedTeam();
        mockParams.values = { id: team.id };
        mockBody.value = {};

        await reopenHandler(createEvent());

        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]!.reason).toBeNull();
    });

    it("returns 404 for an unknown team", async () => {
        mockParams.values = { id: 999 };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Team not found.",
        });
    });

    it("returns 404 when the team season no longer exists", async () => {
        seedSubmittedTeam();
        mockParams.values = { id: 1 };
        mockBody.value = {};
        const fakeDrizzle = new Proxy(ctx.drizzle as any, {
            get(target, property) {
                if (property === "transaction") {
                    return async (callback: any) => {
                        const emptyQuery = { limit: () => Promise.resolve([]) };
                        const fakeTx = {
                            select: () => ({ from: () => ({ where: () => emptyQuery }) }),
                        };
                        return callback(fakeTx);
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        await expect(
            reopenHandler(createEvent({ context: { drizzle: fakeDrizzle } })),
        ).rejects.toMatchObject({ statusCode: 404, message: "Season not found." });
    });

    it("refuses to reopen after results are published", async () => {
        const season = seedSeason(ctx, { name: "Published", is_active: 0, results_published: 1 });
        const team = seedSubmittedTeam("Published Team", { season_id: season.id });
        mockParams.values = { id: team.id };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("refuses to reopen a season with a publication timestamp", async () => {
        const season = seedSeason(ctx, {
            name: "Stamped",
            is_active: 0,
            results_published: 0,
            results_published_at: new Date(),
        });
        const team = seedSubmittedTeam("Stamped Team", { season_id: season.id });
        mockParams.values = { id: team.id };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("refuses to reopen a judged team", async () => {
        const team = seedSubmittedTeam();
        seedTeamEvaluations(ctx, team, 1);
        mockParams.values = { id: team.id };
        mockBody.value = {};

        await expect(reopenHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Delete the team's evaluations before reopening its submission.",
        });
    });
});

describe("PATCH /api/admin/teams/:id/status", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1 };
        mockBody.value = { status: "withdrawn" };

        await expect(statusHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("withdraws a team, clears its rank, and returns the recomputed standings", async () => {
        const team = seedSubmittedTeam();
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
            .insert(teamAwards)
            .values({ team_id: team.id, award: "gold", meta: "{}" })
            .run();
        mockParams.values = { id: team.id };
        mockBody.value = { status: "withdrawn", reason: "No-show" };

        const result = await statusHandler(createEvent());

        expect(result.season_id).toBe(1);
        expect(result.standings).toEqual([
            {
                team_id: team.id,
                name: "Submitted Team",
                pathway: null,
                status: "withdrawn",
                score: 0,
                score_exact: 0,
                rank: null,
                awards: ["Gold"],
                project_name: "",
                project_demo_url: null,
                project_repo_url: null,
            },
        ]);
        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!;
        expect(row.status).toBe("withdrawn");
        expect(row.rank).toBeNull();
        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]).toMatchObject({
            action: "team.status",
            before: { status: "active" },
            after: { status: "withdrawn" },
            reason: "No-show",
        });
    });

    it("restores an active team without clearing its rank field first", async () => {
        const team = seedSubmittedTeam("Restored Team", { status: "withdrawn", rank: 2 });
        mockParams.values = { id: team.id };
        mockBody.value = { status: "active" };

        const result = await statusHandler(createEvent());

        expect(result.standings[0]).toMatchObject({ status: "active", rank: 1 });
        const audit = ctx.drizzle.select().from(adminAuditEvents).all()[0]!;
        expect(audit.reason).toBeNull();
    });

    it("returns 404 for an unknown team", async () => {
        mockParams.values = { id: 999 };
        mockBody.value = { status: "active" };

        await expect(statusHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("DELETE /api/admin/teams/:id/scores/:judgeId", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1, judgeId: 1 };

        await expect(deleteScoreHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("voids one evaluation and returns the recomputed standings", async () => {
        const team = seedSubmittedTeam();
        const other = seedSubmittedTeam("Unawarded Team");
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
            .values({ team_id: team.id, award: "best-design", meta: "{}" })
            .run();
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: team.id,
                judge_user_id: judge.id,
                season_id: 1,
                rubric_version_id: 1,
                scores: "{}",
                reasoning: "",
            } as any)
            .run();
        mockParams.values = { id: team.id, judgeId: judge.id };

        const result = await deleteScoreHandler(createEvent());

        expect(result.season_id).toBe(1);
        expect(result.standings[0]).toMatchObject({
            team_id: team.id,
            score: 0,
            score_exact: 0,
            rank: 1,
            awards: ["Best Design"],
        });
        expect(result.standings.find((row: any) => row.team_id === other.id)).toMatchObject({
            awards: [],
        });
        expect(ctx.drizzle.select().from(teamScores).all()).toHaveLength(0);
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits[0]).toMatchObject({
            action: "score.delete",
            entity_type: "team_score",
            entity_id: `${team.id}:${judge.id}`,
            before: { team_id: team.id, judge_user_id: judge.id },
            reason: "administrator voided an evaluation",
        });
    });

    it("returns 404 for an unknown team", async () => {
        mockParams.values = { id: 999, judgeId: 1 };

        await expect(deleteScoreHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 when the evaluation does not exist", async () => {
        const team = seedSubmittedTeam();
        mockParams.values = { id: team.id, judgeId: 42 };

        await expect(deleteScoreHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Evaluation not found.",
        });
    });
});

describe("DELETE /api/teams/:id", () => {
    function setHackathon(overrides: Record<string, unknown>) {
        ctx.drizzle
            .update(hackathon)
            .set(overrides as any)
            .where(eq(hackathon.id, 1))
            .run();
    }

    it("requires an authenticated user", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1 };

        await expect(disbandHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("disbands a team the caller owns", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Disbanded Team", owner_user_id: owner.id });
        ctx.drizzle.update(teams).set({ status: "active" }).where(eq(teams.id, team.id)).run();
        seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };

        await expect(disbandHandler(createEvent())).resolves.toEqual({ message: "Team disbanded" });

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!;
        expect(row.status).toBe("withdrawn");
    });

    it("returns 404 for an unknown team", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: 999 };

        await expect(disbandHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects a member who is not the owner", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const member = seedUser(ctx, { email: "member@basischina.com" });
        const team = seedTeam(ctx, { name: "Owned Team", owner_user_id: owner.id });
        ctx.drizzle.update(teams).set({ status: "active" }).where(eq(teams.id, team.id)).run();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id };

        await expect(disbandHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can disband it",
        });
    });

    it("rejects disbanding after submissions close or while paused", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Late Team" });
        ctx.drizzle.update(teams).set({ status: "active" }).where(eq(teams.id, team.id)).run();
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: team.id };

        setHackathon({ status: "voting" });
        await expect(disbandHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot disband a team after submissions close",
        });

        setHackathon({ status: "paused" });
        await expect(disbandHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });
});

describe("PATCH /api/teams/:id/owner", () => {
    function setHackathon(overrides: Record<string, unknown>) {
        ctx.drizzle
            .update(hackathon)
            .set(overrides as any)
            .where(eq(hackathon.id, 1))
            .run();
    }

    function seedOwnedTeam() {
        const team = seedTeam(ctx, { name: "Transfer Team" });
        ctx.drizzle
            .update(teams)
            .set({ status: "active", project_submitted: 0 })
            .where(eq(teams.id, team.id))
            .run();
        const owner = seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        ctx.drizzle
            .update(teams)
            .set({ owner_user_id: owner.id })
            .where(eq(teams.id, team.id))
            .run();
        return { owner, member, team };
    }

    it("requires an authenticated user", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1 };
        mockBody.value = { user_id: 1 };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("transfers ownership to a current member", async () => {
        const { owner, member, team } = seedOwnedTeam();
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: member.id };

        await expect(transferHandler(createEvent())).resolves.toEqual({
            message: "Team ownership transferred",
        });

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!;
        expect(row.owner_user_id).toBe(member.id);
    });

    it("returns 404 for an unknown team", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: 999 };
        mockBody.value = { user_id: user.id };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects a caller who is not the owner", async () => {
        const { member, team } = seedOwnedTeam();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: member.id };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can transfer ownership",
        });
    });

    it("rejects a transfer after submissions close or while paused", async () => {
        const { owner, member, team } = seedOwnedTeam();
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: member.id };

        setHackathon({ status: "finished" });
        await expect(transferHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot change team members after submissions close",
        });

        setHackathon({ status: "paused" });
        await expect(transferHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("rejects transferring ownership after the project is submitted", async () => {
        const { owner, member, team } = seedOwnedTeam();
        ctx.drizzle.update(teams).set({ project_submitted: 1 }).where(eq(teams.id, team.id)).run();
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: member.id };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Cannot transfer ownership after the project is submitted",
        });
    });

    it("rejects a target who is not a current member", async () => {
        const { owner, team } = seedOwnedTeam();
        const outsider = seedUser(ctx, { email: "outsider@basischina.com" });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: outsider.id };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects transferring to the current owner", async () => {
        const { owner, team } = seedOwnedTeam();
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { user_id: owner.id };

        await expect(transferHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "That member already owns this team",
        });
    });
});
