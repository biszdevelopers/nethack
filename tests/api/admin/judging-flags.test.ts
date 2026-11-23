import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
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
} from "../helpers";
import { adminAuditEvents, judgeFlags } from "~~/server/database/schema";
import { upsertJudgeFlag } from "~~/server/utils/database/judge-flags";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listFlags: any;
let resolveFlag: any;

beforeAll(async () => {
    setupNitroGlobals();
    listFlags = (await import("~~/server/api/admin/judging/flags/index.get")).default;
    resolveFlag = (await import("~~/server/api/admin/judging/flags/[id].patch")).default;
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

function seedFlag(overrides: Record<string, unknown> = {}) {
    const judge = seedUser(ctx, { email: `judge-${Date.now()}-${Math.random()}@basischina.com` });
    const team = seedTeam(ctx, { name: `Team ${Math.random()}` });
    return ctx.drizzle
        .insert(judgeFlags)
        .values({
            season_id: 1,
            team_id: team.id,
            judge_user_id: judge.id,
            reason: "Conflict of interest",
            created_at: new Date(),
            ...overrides,
        } as any)
        .returning()
        .get();
}

describe("GET /api/admin/judging/flags", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockQueryState.value = {};

        await expect(listFlags(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("lists every flag by default with ISO timestamps", async () => {
        const flag = seedFlag();
        mockQueryState.value = {};

        const result = await listFlags(createEvent());

        expect(result.flags).toHaveLength(1);
        expect(result.flags[0]).toMatchObject({
            id: flag.id,
            season_id: 1,
            team_id: flag.team_id,
            judge_user_id: flag.judge_user_id,
            reason: "Conflict of interest",
            resolved_at: null,
            resolved_by: null,
        });
        expect(result.flags[0].created_at).toBe(flag.created_at.toISOString());
    });

    it("filters open flags for a season", async () => {
        const open = seedFlag();
        seedFlag({ resolved_at: new Date(), resolved_by: 1 });
        mockQueryState.value = { season_id: 1, resolved: "false" };

        const result = await listFlags(createEvent());

        expect(result.flags.map((row: any) => row.id)).toEqual([open.id]);
    });

    it("filters resolved flags and serializes the resolution timestamp", async () => {
        seedFlag();
        const resolved = seedFlag({ resolved_at: new Date(), resolved_by: 1 });
        mockQueryState.value = { resolved: "true" };

        const result = await listFlags(createEvent());

        expect(result.flags).toHaveLength(1);
        expect(result.flags[0].id).toBe(resolved.id);
        expect(typeof result.flags[0].resolved_at).toBe("string");
    });

    it("returns an empty list for another season", async () => {
        seedFlag();
        mockQueryState.value = { season_id: 99 };

        await expect(listFlags(createEvent())).resolves.toEqual({ flags: [] });
    });
});

describe("PATCH /api/admin/judging/flags/:id", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockParams.values = { id: 1 };

        await expect(resolveFlag(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("resolves an open flag and audits the administrator", async () => {
        const flag = seedFlag();
        const admin = seedUser(ctx, { email: "second-admin@basischina.com", is_admin: 1 });
        mockSession.value = { user: { id: admin.id } };
        mockParams.values = { id: flag.id };

        await expect(resolveFlag(createEvent())).resolves.toEqual({ message: "Flag resolved" });

        const row = ctx.drizzle.select().from(judgeFlags).all()[0]!;
        expect(row.resolved_by).toBe(admin.id);
        expect(row.resolved_at).toBeInstanceOf(Date);
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "judging.flag_resolved",
            entity_type: "judge_flag",
            entity_id: String(flag.id),
            after: { resolved_by: admin.id },
        });
    });

    it("returns 404 for a missing or already resolved flag", async () => {
        const flag = seedFlag({ resolved_at: new Date(), resolved_by: 1 });
        mockParams.values = { id: flag.id };

        await expect(resolveFlag(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Open flag not found",
        });

        mockParams.values = { id: 999 };
        await expect(resolveFlag(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("upsertJudgeFlag failure handling", () => {
    it("reports a failed flag insert as a server error", async () => {
        const fakeDrizzle = new Proxy(ctx.drizzle as any, {
            get(target, property) {
                if (property === "transaction") {
                    return async (callback: any) =>
                        callback({
                            insert: () => ({
                                values: () => ({
                                    onConflictDoUpdate: () => ({
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
            upsertJudgeFlag({ context: { drizzle: fakeDrizzle } } as any, {
                seasonId: 1,
                teamId: 1,
                judgeUserId: 1,
                reason: "Conflict",
            }),
        ).rejects.toMatchObject({ statusCode: 500 });
    });
});
