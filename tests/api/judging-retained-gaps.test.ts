import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
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
import { judgeAssignments } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
    JUDGING_DRAFT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let flagHandler: any;
let saveDraftHandler: any;
let historyHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    flagHandler = (await import("~~/server/api/judging/flag.post")).default;
    saveDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].put")).default;
    historyHandler = (await import("~~/server/api/judging/history/[seasonId].get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "voting", judging_open: 1 });
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

describe("POST /api/judging/flag without an active season", () => {
    it("returns 404 before reading the team", async () => {
        ctx.sqlite.exec("DELETE FROM rubric_versions; DELETE FROM seasons;");
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        mockSession.value = { user: { id: judge.id } };
        mockBody.value = { team_id: 1, reason: "Conflict of interest" };

        await expect(flagHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "No active season",
        });
    });
});

describe("PUT /api/judging/drafts/:teamId assignment gate", () => {
    it("rejects a submitted project outside the judge's assignment", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, {
            name: "Junior Team",
            pathway: "junior",
            project_submitted: 1,
        });
        ctx.drizzle
            .insert(judgeAssignments)
            .values({ season_id: 1, judge_user_id: judge.id, pathway: "senior" })
            .run();
        mockSession.value = { user: { id: judge.id } };
        mockParams.values = { teamId: String(team.id) };
        mockBody.value = { scores: {}, reasoning: "", rubric_version_id: 1 };

        await expect(saveDraftHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "This project is outside your judging assignment",
        });
    });
});

describe("GET /api/judging/history/:seasonId pagination", () => {
    it("rejects an invalid limit before reading the season", async () => {
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        mockSession.value = { user: { id: judge.id } };
        mockParams.values = { seasonId: "1" };
        mockQueryState.value = { limit: 0 };

        await expect(historyHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "Invalid pagination parameters.",
        });
    });
});
