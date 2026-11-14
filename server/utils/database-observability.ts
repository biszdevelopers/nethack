import { channel, tracingChannel } from "node:diagnostics_channel";

const BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000];
const REPORT_INTERVAL_MS = 60_000;

class FixedHistogram {
    readonly counts = new Array(BUCKETS_MS.length).fill(0) as number[];
    count = 0;
    sum = 0;
    max = 0;

    record(value: number) {
        if (!Number.isFinite(value) || value < 0) return;
        this.count += 1;
        this.sum += value;
        this.max = Math.max(this.max, value);
        const bucket = BUCKETS_MS.findIndex((limit) => value <= limit);
        this.counts[bucket === -1 ? this.counts.length - 1 : bucket]! += 1;
    }

    percentile(percentile: number): number | null {
        if (this.count === 0) return null;
        const target = Math.ceil(this.count * percentile);
        let seen = 0;
        for (let index = 0; index < this.counts.length; index += 1) {
            seen += this.counts[index]!;
            if (seen >= target) return BUCKETS_MS[index]!;
        }
        return this.max;
    }

    snapshot() {
        return {
            count: this.count,
            average_ms: this.count ? Math.round((this.sum / this.count) * 100) / 100 : null,
            p50_ms: this.percentile(0.5),
            p95_ms: this.percentile(0.95),
            p99_ms: this.percentile(0.99),
            bucket_upper_bounds_ms: BUCKETS_MS,
            bucket_counts: [...this.counts],
            max_ms: this.count ? this.max : null,
        };
    }

    reset() {
        this.count = 0;
        this.sum = 0;
        this.max = 0;
        this.counts.fill(0);
    }
}

const queryRuntime = new FixedHistogram();
const poolAcquireWait = new FixedHistogram();
let queryCount = 0;
let queryErrors = 0;
let poolWaits = 0;
let installed = false;

interface QueryContext {
    queued?: number;
    sent?: number;
    complete?: number;
    error?: unknown;
}

/** Enable bounded, identifier-free PostgreSQL timing summaries with DATABASE_METRICS=1. */
export function installDatabaseMetrics() {
    if (installed || process.env.DATABASE_METRICS !== "1") return;
    installed = true;

    tracingChannel("postgres:query").subscribe({
        asyncEnd(context: QueryContext) {
            queryCount += 1;
            if (context.error) queryErrors += 1;
            if (typeof context.sent === "number" && typeof context.complete === "number") {
                queryRuntime.record(context.complete - context.sent);
            }
        },
    });

    const poolChannel = channel("postgres:pool");
    poolChannel.subscribe((message: unknown) => {
        if (!message || typeof message !== "object") return;
        if (!("event" in message)) return;
        if (message.event === "wait") poolWaits += 1;
        if (
            message.event === "lease" &&
            "waited" in message &&
            typeof message.waited === "number"
        ) {
            poolAcquireWait.record(message.waited);
        }
    });

    const timer = setInterval(() => {
        const report = {
            event: "postgres_metrics",
            timestamp: new Date().toISOString(),
            queries: queryCount,
            query_errors: queryErrors,
            query_runtime: queryRuntime.snapshot(),
            pool_acquire_wait: poolAcquireWait.snapshot(),
            pool_wait_events: poolWaits,
        };
        console.info(JSON.stringify(report));
        queryCount = 0;
        queryErrors = 0;
        poolWaits = 0;
        queryRuntime.reset();
        poolAcquireWait.reset();
    }, REPORT_INTERVAL_MS);
    timer.unref();
}
