import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
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
import { adminAuditEvents, judgeRecusals } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let recuse: any;

beforeAll(async () => {
    setupNitroGlobals();
    recuse = (await import("~~/server/api/judging/recusals.post")).default;
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

describe("POST /api/judging/recusals", () => {
    it("requires a judge permission", async () => {
        mockBody.value = { team_id: 1 };

        await expect(recuse(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("records a recusal for the active season and audits it", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, { name: "Conflicted Team" });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "Friend on the team" };

        await expect(recuse(createEvent())).resolves.toEqual({ message: "Recusal recorded" });

        expect(ctx.drizzle.select().from(judgeRecusals).all()[0]).toMatchObject({
            season_id: 1,
            judge_user_id: judge.id,
            team_id: team.id,
            reason: "Friend on the team",
        });
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "judging.recusal",
            entity_type: "team",
            entity_id: String(team.id),
            after: { judge_user_id: judge.id, reason: "Friend on the team" },
        });
    });

    it("stores a null reason when none is supplied", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, { name: "Conflicted Team" });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id };

        await recuse(createEvent());

        expect(ctx.drizzle.select().from(judgeRecusals).all()[0]!.reason).toBeNull();
        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]!.after).toMatchObject({
            reason: null,
        });
    });

    it("updates the reason when the judge recuses the same team again", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, { name: "Conflicted Team" });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: team.id, reason: "First reason" };
        await recuse(createEvent());

        mockBody.value = { team_id: team.id, reason: "Clarified reason" };
        await recuse(createEvent());

        const rows = ctx.drizzle.select().from(judgeRecusals).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.reason).toBe("Clarified reason");
        expect(ctx.drizzle.select().from(adminAuditEvents).all()).toHaveLength(2);
    });

    it("records a recusal against a season selected by id", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const team = seedTeam(ctx, { name: "Past Team", season_id: past.id });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { season_id: past.id, team_id: team.id, reason: "Historical conflict" };

        await recuse(createEvent());

        expect(ctx.drizzle.select().from(judgeRecusals).all()[0]).toMatchObject({
            season_id: past.id,
            team_id: team.id,
        });
    });

    it("rejects an unknown season", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, { name: "Some Team" });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { season_id: 99, team_id: team.id };

        await expect(recuse(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects an unknown team or a team from another season", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const foreign = seedTeam(ctx, { name: "Foreign", season_id: past.id });
        mockSession.value = { user: { id: judge.id } };

        mockBody.value = { team_id: foreign.id };
        await expect(recuse(createEvent())).rejects.toMatchObject({ statusCode: 404 });

        mockBody.value = { team_id: 999 };
        await expect(recuse(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});
