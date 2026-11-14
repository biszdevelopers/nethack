import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    seedHackathon,
    seedSeason,
    type TestContext,
} from "../helpers";

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    handler = (await import("~~/server/api/seasons/active.get")).default;
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

describe("GET /api/seasons/active", () => {
    it("hides theme details before the hackathon starts", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "not_started" });
        seedSeason(ctx);

        const result = await handler(createEvent());

        expect(result).toHaveProperty("status", "not_started");
        expect(result).toHaveProperty("theme_name", null);
        expect(result).toHaveProperty("theme_description", null);
    });

    it("hides theme details while the hackathon is paused", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "paused" });
        seedSeason(ctx);

        const result = await handler(createEvent());

        expect(result).toHaveProperty("status", "paused");
        expect(result).toHaveProperty("theme_name", null);
        expect(result).toHaveProperty("theme_description", null);
    });

    it("exposes whether judging is open during the voting period", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "voting", judging_open: 1 });
        seedSeason(ctx);

        const result = await handler(createEvent());

        expect(result).toHaveProperty("judging_open", true);
    });
});
