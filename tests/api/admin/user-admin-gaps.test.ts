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
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { eq } from "drizzle-orm";
import { users } from "~~/server/database/schema";

const memberMocks = vi.hoisted(() => ({
    getUserPastTeams: vi.fn(),
}));

vi.mock("~~/server/utils/database/members", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/database/members")>();
    return { ...actual, getUserPastTeams: memberMocks.getUserPastTeams };
});

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

vi.mock("~~/server/utils/auth", () => ({
    requireUser: vi.fn((...args: any[]) => (globalThis as any).requireUser(...args)),
}));

let ctx: TestContext;
let adminHandler: any;
let profileHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getTeamById", teamsDb.getTeamById);
    vi.stubGlobal("getAwardsForTeams", async () => ({}));
    vi.stubGlobal("getScoreRankVisibilityResolver", async () => () => ({
        resultsPublished: false,
        showScores: false,
        showRanking: false,
    }));
    const { convertUserToPublic, convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertUserToPublic", convertUserToPublic);
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    adminHandler = (await import("~~/server/api/users/[id]/admin.patch")).default;
    profileHandler = (await import("~~/server/api/users/[id]/index.get")).default;
});

beforeEach(async () => {
    resetMockState();
    memberMocks.getUserPastTeams.mockReset().mockResolvedValue([]);
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

describe("PATCH /api/users/:id/admin empty update", () => {
    it("returns 404 when the update no longer matches the target row", async () => {
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        const target = seedUser(ctx, { email: "target@basischina.com" });
        mockSession.value = { user: { id: admin.id } };
        mockParams.values = { id: target.id };
        mockBody.value = { is_admin: false };
        const fakeDrizzle = {
            transaction: async (callback: any) =>
                callback({
                    select: () => ({
                        from: () =>
                            Promise.resolve([
                                { id: admin.id, is_admin: 1 },
                                { id: target.id, is_admin: 1 },
                            ]),
                    }),
                    update: () => ({
                        set: () => ({
                            where: () => ({ returning: () => Promise.resolve([]) }),
                        }),
                    }),
                }),
        };
        vi.mocked(globalThis.requireUser).mockResolvedValueOnce({ id: admin.id } as any);

        await expect(
            adminHandler(createEvent({ context: { drizzle: fakeDrizzle } })),
        ).rejects.toMatchObject({ statusCode: 404, message: "User not found" });
    });

    it("returns the updated administrator flag", async () => {
        const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
        const target = seedUser(ctx, { email: "target@basischina.com" });
        mockSession.value = { user: { id: admin.id } };
        mockParams.values = { id: target.id };
        mockBody.value = { is_admin: true };

        await expect(adminHandler(createEvent())).resolves.toEqual({
            id: target.id,
            is_admin: true,
        });
    });
});

describe("GET /api/users/:id stale team pointer", () => {
    it("adds an archived team to the self-view history once", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const archived = seedTeam(ctx, {
            name: "Archived Team",
            season_id: past.id,
            project_submitted: 1,
        });
        ctx.drizzle.update(users).set({ team_id: archived.id }).where(eq(users.id, user.id)).run();
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: user.id };

        const result = await profileHandler(createEvent());

        expect(result.past_teams.map((team: any) => team.id)).toEqual([archived.id]);
        expect(result.team).toBeNull();
    });

    it("returns a self profile without a team", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: user.id };

        const result = await profileHandler(createEvent());

        expect(result).toMatchObject({ team: null, past_teams: [] });
    });
});
