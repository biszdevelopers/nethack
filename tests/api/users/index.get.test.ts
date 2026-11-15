import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "~~/tests/api/helpers";
import { userPastTeams } from "~~/server/database/schema";

let ctx: TestContext;
let listHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const { convertUserToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertUserToPublic", convertUserToPublic);

    listHandler = (await import("~~/server/api/users/index.get")).default;
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

describe("GET /api/users", () => {
    it("returns only public user fields", async () => {
        vi.mocked(globalThis.requirePermission).mockResolvedValue({ id: 1, role: "admin" });

        seedUser(ctx, {
            email: "alice@basischina.com",
            name: "Alice",
        });

        const result = await listHandler(createEvent());

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("email", "alice@basischina.com");
        expect(result[0]).toHaveProperty("name", "Alice");
        expect(result[0]).not.toHaveProperty("role");
        expect(result[0]).toHaveProperty("team_id");
        expect(result[0]).toHaveProperty("profile_theme");
        expect(result[0]).toHaveProperty("profile_picture");
    });

    it("lists every past team id for each user", async () => {
        vi.mocked(globalThis.requirePermission).mockResolvedValue({ id: 1, role: "admin" });
        const alice = seedUser(ctx, { email: "alice@basischina.com" });
        const first = seedTeam(ctx, { name: "First" });
        const second = seedTeam(ctx, { name: "Second" });
        ctx.drizzle
            .insert(userPastTeams)
            .values([
                { user_id: alice.id, team_id: first.id },
                { user_id: alice.id, team_id: second.id },
            ] as any)
            .run();

        const result = await listHandler(createEvent());

        expect(result[0].past_team_ids).toBe(`${first.id},${second.id}`);
    });
});
