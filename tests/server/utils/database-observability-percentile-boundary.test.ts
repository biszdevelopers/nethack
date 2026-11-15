import { tracingChannel } from "node:diagnostics_channel";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("database observability percentile fallback", () => {
    it("returns the observed maximum if a percentile target exceeds bucket totals", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-12T00:00:00.000Z"));
        vi.stubEnv("DATABASE_METRICS", "1");
        vi.resetModules();
        const { installDatabaseMetrics } = await import("~~/server/utils/database-observability");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        installDatabaseMetrics();

        tracingChannel("postgres:query").asyncEnd.publish({ sent: 100, complete: 107 });
        tracingChannel("postgres:query").asyncEnd.publish({ sent: 100, complete: 6101 });
        const originalCeil = Math.ceil;
        vi.spyOn(Math, "ceil").mockImplementation((value) =>
            value > 0 && value <= 2 ? 3 : originalCeil(value),
        );

        await vi.advanceTimersByTimeAsync(60_000);

        const report = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(report.query_runtime).toMatchObject({
            count: 2,
            max_ms: 6001,
            p50_ms: 6001,
            p95_ms: 6001,
            p99_ms: 6001,
        });
    });
});
