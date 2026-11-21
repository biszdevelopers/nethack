import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";

const mocks = vi.hoisted(() => ({
    notifySeasonParticipants: vi.fn(),
}));

vi.mock("~~/server/utils/notifications", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/notifications")>();
    return {
        ...actual,
        notifySeasonParticipants: mocks.notifySeasonParticipants,
    };
});

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let patchHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);

    patchHandler = (await import("~~/server/api/admin/hackathon/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    mocks.notifySeasonParticipants.mockReset();
});

afterEach(() => {
    resetTestContext(ctx);
    vi.restoreAllMocks();
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

describe("PATCH /api/admin/hackathon publication delivery", () => {
    it("keeps publication successful when participant notifications fail", async () => {
        vi.mocked(globalThis.requireAdmin).mockResolvedValue({ id: 1, role: "admin" } as any);
        seedSeason(ctx);
        mocks.notifySeasonParticipants.mockRejectedValueOnce(new Error("delivery down"));
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        mockBody.value = { results_published: 1 };

        await expect(patchHandler(createEvent())).resolves.toHaveProperty("hackathon");

        expect(logged).toHaveBeenCalledWith("results notification failed", expect.any(Error));
    });
});
