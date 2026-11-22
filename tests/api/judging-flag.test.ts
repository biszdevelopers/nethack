import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "./helpers";
import {
    adminAuditEvents,
    judgeFlags,
    notifications,
    seasons,
    userPastTeams,
} from "~~/server/database/schema";
import { getJudgeFlags, resolveJudgeFlag } from "~~/server/utils/database/judge-flags";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let flagHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    flagHandler = (await import("~~/server/api/judging/flag.post")).default;
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

describe("POST /api/judging/flag", () => {
    it("records a conflict flag, audits it, and notifies administrators", async () => {
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        const team = seedTeam(ctx, { name: "Flagged Team" });

        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "I mentored this team last term." };

        await expect(flagHandler(createEvent())).resolves.toEqual({
            message: "Flag reported to the organizers",
        });

        const flags = ctx.drizzle.select().from(judgeFlags).all();
        expect(flags).toHaveLength(1);
        expect(flags[0]).toMatchObject({
            season_id: team.season_id,
            team_id: team.id,
            judge_user_id: judge.id,
            reason: "I mentored this team last term.",
            resolved_at: null,
        });
        expect(ctx.drizzle.select().from(adminAuditEvents).all()).toHaveLength(1);
        const notices = ctx.drizzle.select().from(notifications).all();
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ user_id: admin.id, type: "judge_flag" });
    });

    it("refreshes the reason when the same judge flags the team again", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        const team = seedTeam(ctx, { name: "Flagged Team" });

        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "First conflict report." };
        await flagHandler(createEvent());

        mockBody.value = { team_id: team.id, reason: "Updated conflict report." };
        await flagHandler(createEvent());

        const flags = ctx.drizzle.select().from(judgeFlags).all();
        expect(flags).toHaveLength(1);
        expect(flags[0]!.reason).toBe("Updated conflict report.");
    });

    it("rejects a team outside the active season", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past season", is_active: 0 });
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        const team = seedTeam(ctx, { name: "Old Team", season_id: pastSeason.id });

        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "Conflict with a past project." };

        await expect(flagHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects flagging a team the judge previously belonged to", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        const team = seedTeam(ctx, { name: "Former Team" });
        ctx.drizzle.insert(userPastTeams).values({ user_id: judge.id, team_id: team.id }).run();

        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "I was on this team before." };

        await expect(flagHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Judges cannot flag a team they belonged to",
        });
    });

    it("rejects flagging the judge's own team", async () => {
        const team = seedTeam(ctx, { name: "Own Team" });
        const judge = seedUser(ctx, {
            email: "judge@basischina.com",
            team_id: team.id,
        });

        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "This should never be accepted." };

        await expect(flagHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Judges cannot flag their own team",
        });
    });
});

describe("judge flag administration helpers", () => {
    it("lists open flags and resolves one exactly once", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", name: "Judge" });
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        const team = seedTeam(ctx, { name: "Flagged Team" });
        ctx.drizzle
            .insert(judgeFlags)
            .values({
                season_id: team.season_id,
                team_id: team.id,
                judge_user_id: judge.id,
                reason: "Conflict",
                created_at: new Date(),
            })
            .run();

        const open = await getJudgeFlags(ctx.drizzle as any, { resolved: false });
        expect(open).toHaveLength(1);
        expect(open[0]).toMatchObject({
            team_name: "Flagged Team",
            judge_email: "judge@basischina.com",
            judge_name: "Judge",
        });

        const flagID = open[0]!.id;
        await resolveJudgeFlag(createEvent(), flagID, admin.id);
        await expect(resolveJudgeFlag(createEvent(), flagID, admin.id)).rejects.toMatchObject({
            statusCode: 404,
        });

        const resolved = await getJudgeFlags(ctx.drizzle as any, { resolved: true });
        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.resolved_by).toBe(admin.id);
    });

    it("filters by season", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        const team = seedTeam(ctx, { name: "Flagged Team" });
        ctx.drizzle
            .insert(judgeFlags)
            .values({
                season_id: team.season_id,
                team_id: team.id,
                judge_user_id: judge.id,
                reason: "Conflict",
                created_at: new Date(),
            })
            .run();

        const otherSeason = ctx.drizzle
            .insert(seasons)
            .values({ name: "Other season", is_active: 0 })
            .returning()
            .get();

        const flags = await getJudgeFlags(ctx.drizzle as any, { seasonId: otherSeason.id });
        expect(flags).toHaveLength(0);
        const active = await getJudgeFlags(ctx.drizzle as any, { seasonId: team.season_id });
        expect(active).toHaveLength(1);
    });
});
