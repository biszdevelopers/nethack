import { tracingChannel } from "node:diagnostics_channel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
    const client = { end: vi.fn().mockResolvedValue(undefined) };
    return {
        client,
        database: { tag: "postgres-drizzle" },
        postgres: vi.fn(() => client),
        drizzle: vi.fn(() => ({ tag: "postgres-drizzle" })),
        installDatabaseMetrics: vi.fn(),
    };
});

vi.mock("postgres", () => ({ default: state.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: state.drizzle }));
vi.mock("~~/server/utils/database-observability", () => ({
    installDatabaseMetrics: state.installDatabaseMetrics,
}));

const channel = tracingChannel("postgres:query");

const slowWarnings = (threshold: number) =>
    (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => {
            try {
                return JSON.parse(String(call[0])) as { threshold_ms?: number };
            } catch {
                return {};
            }
        })
        .filter((payload) => payload.threshold_ms === threshold);

const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_METRICS: process.env.DATABASE_METRICS,
    DATABASE_SLOW_QUERY_MS: process.env.DATABASE_SLOW_QUERY_MS,
};

beforeEach(() => {
    process.env.DATABASE_URL = "postgres://localhost/app";
    state.postgres.mockClear();
    state.drizzle.mockClear();
    state.installDatabaseMetrics.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    if (originalEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    if (originalEnv.DATABASE_METRICS === undefined) delete process.env.DATABASE_METRICS;
    else process.env.DATABASE_METRICS = originalEnv.DATABASE_METRICS;
    if (originalEnv.DATABASE_SLOW_QUERY_MS === undefined) delete process.env.DATABASE_SLOW_QUERY_MS;
    else process.env.DATABASE_SLOW_QUERY_MS = originalEnv.DATABASE_SLOW_QUERY_MS;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("slow query logging", () => {
    it("only reports slow queries, caps log volume, and reopens the window after a minute", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        process.env.DATABASE_METRICS = "1";
        process.env.DATABASE_SLOW_QUERY_MS = "100";
        const database = await import("~~/server/database");

        await database.createDrizzleDatabase();
        await database.createDrizzleDatabase();
        expect(state.postgres).toHaveBeenCalledOnce();

        // A context that is not timing data is ignored.
        await channel.tracePromise(async () => undefined, { sent: "x", complete: 10 });
        // A query under the threshold is not logged.
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 50 });
        expect(slowWarnings(100)).toHaveLength(0);

        await channel.tracePromise(async () => undefined, { sent: 0, complete: 150 });
        expect(slowWarnings(100)).toHaveLength(1);

        for (let index = 0; index < 20; index += 1) {
            await channel.tracePromise(async () => undefined, { sent: 0, complete: 150 });
        }
        expect(slowWarnings(100)).toHaveLength(20);

        vi.setSystemTime(Date.now() + 60_001);
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 150 });
        expect(slowWarnings(100)).toHaveLength(21);

        expect(slowWarnings(100)[0]).toMatchObject({ event: "postgres_slow_query" });
        await database.closeDatabase();
    });

    it("defaults the threshold when DATABASE_SLOW_QUERY_MS is unset", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        process.env.DATABASE_METRICS = "1";
        delete process.env.DATABASE_SLOW_QUERY_MS;
        const database = await import("~~/server/database");

        await database.createDrizzleDatabase();
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 300 });

        expect(slowWarnings(250).length).toBeGreaterThanOrEqual(1);
        await database.closeDatabase();
    });

    it("falls back to the default for an invalid threshold", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        process.env.DATABASE_METRICS = "1";
        process.env.DATABASE_SLOW_QUERY_MS = "0";
        const database = await import("~~/server/database");

        await database.createDrizzleDatabase();
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 300 });
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 100 });

        expect(slowWarnings(250).length).toBeGreaterThanOrEqual(1);
        expect(slowWarnings(0)).toHaveLength(0);
        await database.closeDatabase();
    });

    it("does nothing when database metrics are disabled", async () => {
        delete process.env.DATABASE_METRICS;
        const database = await import("~~/server/database");

        await database.createDrizzleDatabase();
        await channel.tracePromise(async () => undefined, { sent: 0, complete: 300 });

        expect(state.postgres).toHaveBeenCalledOnce();
        await database.closeDatabase();
    });
});
