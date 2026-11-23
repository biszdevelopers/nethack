import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals, resetMockState } from "./helpers";

const mocks = vi.hoisted(() => ({
    getEventState: vi.fn(),
}));

vi.mock("~~/server/utils/event-state", () => ({
    getEventState: mocks.getEventState,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let listTeams: any;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("getActiveSeason", async () => ({ id: 1 }));
    vi.stubGlobal("getAwardsForTeams", async () => ({}));
    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);
    listTeams = (await import("~~/server/api/teams/index.get")).default;
});

beforeEach(() => {
    resetMockState();
    mocks.getEventState.mockReset().mockResolvedValue({
        season: { id: 1 },
        hackathon: { status: "voting", judging_open: 1, voting_enabled: 1 },
        submissionsOpen: false,
        submissionsClosed: true,
        votingOpen: true,
        judgingOpen: true,
        galleryPublic: true,
        resultsVisible: false,
    });
});

describe("GET /api/teams judging page with no aggregate rows", () => {
    it("falls back to zero totals when the database returns no count row", async () => {
        const chain: any = {
            where: () => chain,
            innerJoin: () => chain,
            orderBy: () => chain,
            limit: () => chain,
            offset: () => chain,
            then: (resolve: any) => resolve([]),
        };
        const fakeDrizzle = { select: () => ({ from: () => chain }) };
        vi.mocked(globalThis.requireUser).mockResolvedValueOnce({
            id: 1,
            team_id: null,
        } as any);
        const { mockQueryState } = await import("./helpers");
        mockQueryState.value = { judging: "true", page: 1, page_size: 10 };

        const result = await listTeams({
            context: { drizzle: fakeDrizzle },
            path: "/api/teams",
        });

        expect(result).toEqual({
            items: [],
            page: 1,
            page_size: 10,
            total: 0,
            total_pages: 0,
        });
    });
});
