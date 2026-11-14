import { channel, tracingChannel } from "node:diagnostics_channel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDatabaseMetrics } from "~~/server/utils/database-observability";

describe("database observability", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("reports query timings and actual pool lease wait separately", async () => {
        vi.useFakeTimers();
        vi.stubEnv("DATABASE_METRICS", "1");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

        installDatabaseMetrics();
        tracingChannel("postgres:query").asyncEnd.publish({
            queued: 100,
            sent: 110,
            complete: 130,
        });
        tracingChannel("postgres:query").asyncEnd.publish({
            queued: 200,
            sent: null,
            complete: null,
            error: new Error("pool checkout failed"),
        });
        channel("postgres:pool").publish({
            event: "lease",
            waited: 14,
        });
        channel("postgres:pool").publish({
            event: "wait",
            waiting: 1,
        });

        await vi.advanceTimersByTimeAsync(60_000);

        const report = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(report).toMatchObject({
            event: "postgres_metrics",
            queries: 2,
            query_errors: 1,
            pool_wait_events: 1,
            query_runtime: {
                count: 1,
                average_ms: 20,
            },
            pool_acquire_wait: {
                count: 1,
                average_ms: 14,
            },
        });
    });
});
