import { channel, tracingChannel } from "node:diagnostics_channel";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("database observability edge cases", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("ignores malformed pool events, rejects invalid timings, and resets empty histograms", async () => {
        vi.useFakeTimers();
        vi.stubEnv("DATABASE_METRICS", "0");
        vi.resetModules();
        const { installDatabaseMetrics } = await import("~~/server/utils/database-observability");

        installDatabaseMetrics();
        vi.stubEnv("DATABASE_METRICS", "1");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        installDatabaseMetrics();
        installDatabaseMetrics();

        tracingChannel("postgres:query").asyncEnd.publish({
            sent: 100,
            complete: 90,
        });
        tracingChannel("postgres:query").asyncEnd.publish({
            error: new Error("query failed"),
        });

        const pool = channel("postgres:pool");
        pool.publish(null);
        pool.publish("invalid");
        pool.publish({});
        pool.publish({ event: "lease" });
        pool.publish({ event: "lease", waited: "not-a-number" });
        pool.publish({ event: "lease", waited: -1 });
        pool.publish({ event: "wait" });

        await vi.advanceTimersByTimeAsync(60_000);
        const firstReport = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(firstReport).toMatchObject({
            queries: 2,
            query_errors: 1,
            pool_wait_events: 1,
            query_runtime: {
                count: 0,
                average_ms: null,
                p50_ms: null,
                max_ms: null,
            },
            pool_acquire_wait: {
                count: 0,
                average_ms: null,
                p50_ms: null,
                max_ms: null,
            },
        });

        await vi.advanceTimersByTimeAsync(60_000);
        expect(info).toHaveBeenCalledTimes(2);
        const secondReport = JSON.parse(String(info.mock.calls[1]?.[0]));
        expect(secondReport).toMatchObject({
            queries: 0,
            query_errors: 0,
            pool_wait_events: 0,
            query_runtime: { count: 0, average_ms: null },
            pool_acquire_wait: { count: 0, average_ms: null },
        });
    });
});
