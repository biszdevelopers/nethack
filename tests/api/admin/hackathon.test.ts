import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    seedHackathon,
    seedSeason,
    type TestContext,
} from "../helpers";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let getHandler: any;
let patchHandler: any;
let createSeasonHandler: any;
let updateSeasonHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);

    getHandler = (await import("~~/server/api/admin/hackathon/index.get")).default;
    patchHandler = (await import("~~/server/api/admin/hackathon/index.patch")).default;
    createSeasonHandler = (await import("~~/server/api/admin/seasons/index.post")).default;
    updateSeasonHandler = (await import("~~/server/api/admin/seasons/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function gRequireAdmin() {
    return vi.mocked(globalThis.requireAdmin);
}

describe("GET /api/admin/hackathon", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(getHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns hackathon config and seasons", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx);

        const result = await getHandler(createEvent());

        expect(result).toHaveProperty("hackathon");
        expect(result.hackathon).toHaveProperty("status");
        expect(result).toHaveProperty("seasons");
        expect(Array.isArray(result.seasons)).toBe(true);
        expect(result.configSource).toBe("database");
    });

    it("reports a remote manifest source", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/HACKATHON.yml");
        try {
            await expect(getHandler(createEvent())).resolves.toMatchObject({
                configSource: "remote",
            });
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe("PATCH /api/admin/hackathon", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(patchHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("updates hackathon status", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { status: "in_progress" };

        const result = await patchHandler(createEvent());

        expect(result.hackathon.status).toBe("in_progress");
    });

    it("updates voting_enabled, judging_open, results_published", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { voting_enabled: 1, judging_open: 1, results_published: 0 };

        const result = await patchHandler(createEvent());

        expect(result.hackathon.voting_enabled).toBe(1);
        expect(result.hackathon.judging_open).toBe(1);
        expect(result.hackathon.results_published).toBe(0);
    });

    it("rejects invalid status", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { status: "invalid_status" };

        await expect(patchHandler(createEvent())).rejects.toThrow();
    });

    it("rejects empty body", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = {};

        await expect(patchHandler(createEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a body whose fields are all nullish", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { schedule_start: null, theme_description: null };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "No fields to update",
        });
    });

    it("returns 404 for an unknown season in database mode", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { season_id: 987, theme_name: "Nowhere" };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("mirrors global settings onto the active season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        const season = seedSeason(ctx);
        mockBody.value = { theme_name: "Mirrored theme", show_scores: 1 };

        await patchHandler(createEvent());

        const row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, season.id)).get()!;
        expect(row.theme_name).toBe("Mirrored theme");
        expect(row.show_scores).toBe(1);
    });

    it("persists changes to the database", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { theme_name: "AI Innovators", max_votes_per_user: 5 };

        await patchHandler(createEvent());

        const row = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get()!;
        expect(row.theme_name).toBe("AI Innovators");
        expect(row.max_votes_per_user).toBe(5);
    });

    it("persists two sequential per-season timestamp saves without losing either", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        // Create season 1 with per-season config columns
        const s1 = ctx.drizzle
            .insert(seasons)
            .values({ name: "Season 1", is_active: 1 } as any)
            .returning()
            .get();

        // First PATCH: save start_timestamp to season 1
        mockBody.value = { start_timestamp: 1737367200000, season_id: s1.id };
        await patchHandler(createEvent());

        // Verify start_timestamp was saved
        let row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, s1.id)).get()!;
        expect(row.start_timestamp).toBe(1737367200000);

        // Second PATCH: save end_timestamp to season 1 (different field)
        mockBody.value = { end_timestamp: 1740000000000, season_id: s1.id };
        await patchHandler(createEvent());

        // Verify BOTH fields are now set
        row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, s1.id)).get()!;
        expect(row.start_timestamp).toBe(1737367200000);
        expect(row.end_timestamp).toBe(1740000000000);
    });

    it("persists two sequential global saves without losing either", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        // First PATCH: save start_timestamp globally
        mockBody.value = { start_timestamp: 1737367200000 };
        await patchHandler(createEvent());

        let row = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get()!;
        expect(row.start_timestamp).toBe(1737367200000);

        // Second PATCH: save end_timestamp globally
        mockBody.value = { end_timestamp: 1740000000000 };
        await patchHandler(createEvent());

        row = ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get()!;
        expect(row.start_timestamp).toBe(1737367200000);
        expect(row.end_timestamp).toBe(1740000000000);
    });
});

describe("PATCH /api/admin/hackathon under manifest authority", () => {
    function createManifestEvent(season: Record<string, unknown> | null) {
        const updates: Record<string, unknown>[] = [];
        const query: any = {
            from: () => query,
            where: () => query,
            for: () => query,
            then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve(season ? [season] : []).then(resolve, reject),
        };
        const transaction = {
            select: () => query,
            update: () => ({
                set: (values: Record<string, unknown>) => ({
                    where: async () => {
                        updates.push(values);
                    },
                }),
            }),
        };
        const drizzle = new Proxy(
            {
                transaction: async (run: (transaction: typeof transaction) => unknown) =>
                    run(transaction),
            },
            {
                get(target, property, receiver) {
                    if (property in target) return Reflect.get(target, property, receiver);
                    const value = Reflect.get(ctx.drizzle as any, property);
                    return typeof value === "function" ? value.bind(ctx.drizzle) : value;
                },
            },
        );
        return { event: { context: { drizzle } }, updates };
    }

    beforeEach(() => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("rejects a live update that omits the season hint", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { theme_name: "Manifest only" };
        const { event, updates } = createManifestEvent({ is_active: 0 });

        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 409 });
        expect(updates).toEqual([]);
    });

    it("rejects changes to the active season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { season_id: 1, theme_name: "Manifest only" };
        const { event, updates } = createManifestEvent({ is_active: 1 });

        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 409 });
        expect(updates).toEqual([]);
    });

    it("rejects an unknown season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { season_id: 987, theme_name: "Nowhere" };
        const { event, updates } = createManifestEvent(null);

        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(updates).toEqual([]);
    });

    it("updates a historical season without touching live settings", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { season_id: 2, theme_name: "Archived theme" };
        const { event, updates } = createManifestEvent({ is_active: 0 });

        await expect(patchHandler(event)).resolves.toHaveProperty("seasons");
        expect(updates).toEqual([{ theme_name: "Archived theme" }]);
    });
});

describe("POST /api/admin/seasons", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(createSeasonHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("creates a new season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { name: "Summer Hack 2026" };

        const result = await createSeasonHandler(createEvent());

        expect(result.seasons.some((s: any) => s.name === "Summer Hack 2026")).toBe(true);
    });

    it("seeds with a unique name", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { name: "Unique Season Name" };

        const result = await createSeasonHandler(createEvent());
        expect(result.seasons.some((s: any) => s.name === "Unique Season Name")).toBe(true);
    });
});

describe("PATCH /api/admin/seasons", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(updateSeasonHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("renames a season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx);
        mockBody.value = { id: 1, name: "Renamed Season" };

        const result = await updateSeasonHandler(createEvent());

        expect(result.seasons.find((s: any) => s.id === 1)?.name).toBe("Renamed Season");
    });

    it("activates a season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx);
        mockBody.value = { id: 1, is_active: 1 };

        const result = await updateSeasonHandler(createEvent());

        expect(result.seasons.find((s: any) => s.id === 1)?.is_active).toBe(1);
    });

    it("rejects non-existent season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        mockBody.value = { id: 999, name: "Ghost Season" };

        await expect(updateSeasonHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects an update with no fields", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx);
        mockBody.value = { id: 1 };

        await expect(updateSeasonHandler(createEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it("activates exactly one season through the activation flow", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        const current = seedSeason(ctx);
        const next = ctx.drizzle
            .insert(seasons)
            .values({ name: "Season 2", is_active: 0 } as any)
            .returning()
            .get();
        mockBody.value = { id: next.id, is_active: 1 };

        const result = await updateSeasonHandler(createEvent());

        expect(result.seasons.find((season: any) => season.id === next.id)?.is_active).toBe(1);
        expect(result.seasons.find((season: any) => season.id === current.id)?.is_active).toBe(0);
    });

    it("reports a duplicate season name as a conflict", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx);
        mockBody.value = { name: "Season 1" };

        await expect(createSeasonHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
        });
    });
});
