import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = fileURLToPath(new URL("../../scripts/benchmark-vps.mjs", import.meta.url));
const targetsPath = "/test-data/targets.json";
const processArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
    vi.useRealTimers();
    process.argv = processArgv;
    process.exitCode = originalExitCode;
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:perf_hooks");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

interface BenchmarkOptions {
    mode?: "idle" | "load";
    targets?: unknown[];
    baseline?: Record<string, unknown>;
    extraArgs?: string[];
    rawArgs?: string[];
    readOverrides?: Record<string, string>;
    fetchResponses?: Array<{ status: number; body?: { getReader: () => unknown } | null } | Error>;
    headersJson?: string;
    signals?: string[];
    noAvailableParallelism?: boolean;
    forcePercentileFallback?: boolean;
    performanceStepMs?: number;
}

async function runBenchmark(options: BenchmarkOptions = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T00:00:00.000Z"));
    vi.resetModules();
    let clock = 0;
    const performance = { now: () => (clock += options.performanceStepMs ?? 250) };
    const files: Record<string, string> = {
        [targetsPath]: JSON.stringify(options.targets ?? [{ path: "/health", type: "api" }]),
        "/proc/4321/status": "Name:\tbasishacks\nVmRSS:\t1024 kB\n",
        "/proc/4321/stat": "4321 (node) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14\n",
        "/test-data/cgroup-memory": "4096\n",
        "/test-data/database-metrics": "",
        ...(options.baseline
            ? { "/test-data/baseline.json": JSON.stringify(options.baseline) }
            : {}),
        ...options.readOverrides,
    };
    const readFile = vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error(`Unexpected benchmark file read: ${path}`);
        return files[path]!;
    });
    const writeFile = vi.fn(async () => undefined);
    vi.doMock("node:fs/promises", () => ({ readFile, writeFile }));
    vi.doMock("node:perf_hooks", () => ({ performance }));
    if (options.noAvailableParallelism) {
        vi.doMock("node:os", () => ({ default: { cpus: () => [{}, {}] } }));
    }
    if (options.forcePercentileFallback) {
        const realCeil = Math.ceil;
        vi.spyOn(Math, "ceil").mockImplementation((value) =>
            value > 0 && value < 1 ? 2 : realCeil(value),
        );
    }

    const responses = [...(options.fetchResponses ?? [{ status: 200, body: null }])];
    const fetchMock = vi.fn(async () => {
        const response = responses.shift() ?? { status: 200, body: null };
        if (response instanceof Error) throw response;
        return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
        queueMicrotask(callback);
        return 0;
    });
    vi.stubEnv("BENCHMARK_HEADERS_JSON", options.headersJson ?? '{"Authorization":"Bearer test"}');
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const signalHandlers = new Map<string, () => void>();
    const processOn = vi.spyOn(process, "on").mockImplementation(((signal, handler) => {
        signalHandlers.set(String(signal), handler as () => void);
        if (options.signals?.includes(String(signal))) (handler as () => void)();
        return process;
    }) as any);

    const mode = options.mode ?? "idle";
    const defaultArgs = [
        "--mode",
        mode,
        "--url",
        "https://basishacks.example.test",
        "--pid",
        "4321",
        "--targets",
        targetsPath,
        "--duration",
        "1",
        "--warmup",
        "1",
        "--runtime",
        "bun",
        "--cgroup-memory-file",
        "/test-data/cgroup-memory",
        ...(mode === "load" ? ["--database-metrics", "/test-data/database-metrics"] : []),
        ...(options.baseline ? ["--baseline", "/test-data/baseline.json"] : []),
        ...(options.extraArgs ?? []),
    ];
    const args = options.rawArgs ?? defaultArgs;
    process.argv = [process.execPath, scriptPath, ...args];
    process.exitCode = 0;

    let importError: unknown;
    try {
        await import("../../scripts/benchmark-vps.mjs");
    } catch (error) {
        importError = error;
    }

    const reportText = log.mock.calls.at(-1)?.[0];
    return {
        error: importError,
        report: typeof reportText === "string" ? JSON.parse(reportText) : undefined,
        exitCode: process.exitCode,
        readFile,
        writeFile,
        fetchMock,
        info,
        errorLog,
        processOn,
        signalHandlers,
    };
}

describe("VPS benchmark execution paths", () => {
    it("runs an idle benchmark, drains a response, and writes the report", async () => {
        const reader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({ done: false })
                .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
        };
        const run = await runBenchmark({
            targets: [{ name: "Health", path: "/health", type: "api", nPlusOne: true }],
            fetchResponses: [{ status: 200, body: { getReader: () => reader } }],
            extraArgs: ["--output", "/test-data/report.json"],
        });

        expect(run.error).toBeUndefined();
        expect(run.report).toMatchObject({
            mode: "idle",
            runtime: "bun",
            duration_complete: true,
            memory_sampling: { complete: true, process_rss_samples: 1 },
            statuses: { "200": expect.any(Number) },
            targets: [{ name: "Health", n_plus_one: true }],
        });
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(reader.releaseLock).toHaveBeenCalledOnce();
        expect(run.writeFile).toHaveBeenCalledOnce();
        expect(run.fetchMock).toHaveBeenCalled();
    });

    it("runs load workers and aggregates in-window database metrics", async () => {
        const metric = JSON.stringify({
            event: "postgres_metrics",
            timestamp: "2026-11-12T00:00:00.000Z",
            queries: 5,
            query_errors: 1,
            pool_wait_events: 2,
            query_runtime: {
                bucket_counts: [1],
                bucket_upper_bounds_ms: [1],
                count: 1,
                average_ms: 1,
                max_ms: 1,
            },
            pool_acquire_wait: {
                bucket_counts: [1],
                bucket_upper_bounds_ms: [1],
                count: 1,
                average_ms: 1,
                max_ms: 1,
            },
        });
        const run = await runBenchmark({
            mode: "load",
            targets: [{ name: "Results", path: "/api/results", type: "report" }],
            readOverrides: { "/test-data/database-metrics": `${metric}\nnot-json\n` },
            extraArgs: ["--users", "2"],
        });

        expect(run.error).toBeUndefined();
        expect(run.report).toMatchObject({
            mode: "load",
            users: 2,
            database_metrics: { sample_count: 1, queries: 5, query_errors: 1, pool_wait_events: 2 },
        });
    });

    it("records an unexpected status and request failure as errors", async () => {
        const run = await runBenchmark({
            targets: [{ path: "/health", expectedStatuses: [204] }],
            fetchResponses: Array.from({ length: 10 }, () => ({ status: 503, body: null })),
        });

        expect(run.error).toBeUndefined();
        expect(run.report.unexpected_error_rate).toBeGreaterThan(0);
        expect(run.report.statuses[503]).toBeGreaterThan(0);
    });
});

describe("VPS benchmark input action patterns", () => {
    const base = {
        "--mode": "idle",
        "--url": "https://basishacks.example.test",
        "--pid": "4321",
        "--targets": targetsPath,
    };

    const argv = (values: Record<string, string | undefined>) =>
        Object.entries(values).flatMap(([key, value]) => (value === undefined ? [] : [key, value]));

    it.each([
        { name: "bare argument", rawArgs: ["unexpected"], message: "Unexpected argument" },
        { name: "missing option value", rawArgs: ["--mode"], message: "Missing value for --mode" },
        {
            name: "invalid mode",
            values: { ...base, "--mode": "other" },
            message: "--mode must be idle or load",
        },
        {
            name: "invalid runtime",
            values: { ...base, "--runtime": "deno" },
            message: "--runtime must be bun or node",
        },
        {
            name: "missing URL",
            values: { ...base, "--url": undefined },
            message: "--url is required",
        },
        {
            name: "invalid URL syntax",
            values: { ...base, "--url": "invalid" },
            message: "absolute HTTP or HTTPS URL",
        },
        {
            name: "unsupported URL protocol",
            values: { ...base, "--url": "ftp://basishacks.example.test" },
            message: "absolute HTTP or HTTPS URL",
        },
        {
            name: "zero process id",
            values: { ...base, "--pid": "0" },
            message: "Linux app process ID",
        },
        {
            name: "non-numeric process id",
            values: { ...base, "--pid": "pid" },
            message: "Linux app process ID",
        },
        {
            name: "missing target path",
            values: { ...base, "--targets": undefined },
            message: "--targets must point",
        },
        {
            name: "load users must be positive",
            values: { ...base, "--mode": "load", "--users": "0" },
            message: "Expected a positive integer",
        },
        {
            name: "load requires cgroup file",
            values: { ...base, "--mode": "load" },
            message: "--cgroup-memory-file is required",
        },
        {
            name: "load requires database metrics",
            values: {
                ...base,
                "--mode": "load",
                "--cgroup-memory-file": "/test-data/cgroup-memory",
            },
            message: "--database-metrics is required",
        },
        {
            name: "invalid positive integer",
            values: { ...base, "--duration": "0" },
            message: "Expected a positive integer",
        },
        {
            name: "fractional positive integer",
            values: { ...base, "--warmup": "1.5" },
            message: "Expected a positive integer",
        },
    ])("rejects $name", async ({ rawArgs, values, message }) => {
        const run = await runBenchmark({ rawArgs: rawArgs ?? argv(values!) });
        expect(String(run.error)).toContain(message);
    });

    it.each([
        { name: "empty target array", targets: [], message: "at least one request object" },
        { name: "null target", targets: [null], message: "must be an object with a path string" },
        {
            name: "non-string path",
            targets: [{ path: 4 }],
            message: "must be an object with a path string",
        },
        {
            name: "unresolvable URL",
            targets: [{ path: "http://[" }],
            message: "path must resolve to a valid URL",
        },
        {
            name: "cross-origin URL",
            targets: [{ path: "https://outside.example.test/x" }],
            message: "must use the same origin",
        },
        {
            name: "invalid method characters",
            targets: [{ path: "/health", method: "G/ET" }],
            message: "invalid HTTP method",
        },
        {
            name: "mutation without explicit opt-in",
            targets: [{ path: "/write", method: "POST" }],
            message: "Add --allow-mutations true",
        },
        {
            name: "body on GET",
            targets: [{ path: "/health", body: "payload" }],
            message: "body on a non-mutating method",
        },
        {
            name: "null headers",
            targets: [{ path: "/health", headers: null }],
            message: "headers must be an object",
        },
        {
            name: "array headers",
            targets: [{ path: "/health", headers: [] }],
            message: "headers must be an object",
        },
        {
            name: "non-array expected statuses",
            targets: [{ path: "/health", expectedStatuses: 200 }],
            message: "expectedStatuses must be an array",
        },
        {
            name: "invalid expected status",
            targets: [{ path: "/health", expectedStatuses: [99] }],
            message: "expectedStatuses must be an array",
        },
        {
            name: "non-positive p95 limit",
            targets: [{ path: "/health", p95LimitMs: 0 }],
            message: "p95LimitMs must be a positive number",
        },
        {
            name: "empty name",
            targets: [{ path: "/health", name: "" }],
            message: "name must be a non-empty string",
        },
        {
            name: "non-string name",
            targets: [{ path: "/health", name: 3 }],
            message: "name must be a non-empty string",
        },
        {
            name: "unknown target type",
            targets: [{ path: "/health", type: "task" }],
            message: "type must be page, api, or report",
        },
        {
            name: "non-boolean nPlusOne",
            targets: [{ path: "/health", nPlusOne: "true" }],
            message: "nPlusOne must be a boolean",
        },
    ])("rejects $name", async ({ targets, message }) => {
        const run = await runBenchmark({ targets });
        expect(String(run.error)).toContain(message);
        expect(run.fetchMock).not.toHaveBeenCalled();
    });

    it("accepts HTTP targets, mutation opt-in, valid optional fields, and nullish defaults", async () => {
        const run = await runBenchmark({
            targets: [
                {
                    path: "/submit",
                    method: "post",
                    body: "{}",
                    headers: { "Content-Type": "application/json" },
                    expectedStatuses: [200, 201],
                    p95LimitMs: 900,
                    name: "Create entry",
                    type: "report",
                    nPlusOne: false,
                },
            ],
            rawArgs: argv({
                ...base,
                "--url": "http://127.0.0.1:3000",
                "--allow-mutations": "true",
                "--duration": "1",
                "--warmup": "1",
            }),
        });

        expect(run.error).toBeUndefined();
        expect(run.report.targets[0]).toMatchObject({ name: "Create entry", p95_limit_ms: 900 });
        expect(run.fetchMock).toHaveBeenCalledWith(
            new URL("/submit", "http://127.0.0.1:3000"),
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
    });

    it.each(["[]", "null", '"string"'])(
        "rejects non-object benchmark headers JSON %s",
        async (headersJson) => {
            const run = await runBenchmark({ headersJson });
            expect(String(run.error)).toContain("BENCHMARK_HEADERS_JSON must be a JSON object");
        },
    );

    it("rejects malformed benchmark headers JSON", async () => {
        const run = await runBenchmark({ headersJson: "{" });
        expect(run.error).toBeInstanceOf(SyntaxError);
    });

    it("uses empty optional benchmark headers when the environment variable is blank", async () => {
        const run = await runBenchmark({ headersJson: "" });

        expect(run.error).toBeUndefined();
        expect(run.fetchMock).toHaveBeenCalled();
    });

    it("rejects malformed target-file JSON", async () => {
        const run = await runBenchmark({ readOverrides: { [targetsPath]: "{" } });
        expect(run.error).toBeInstanceOf(SyntaxError);
    });
});

describe("VPS benchmark sampling and report gates", () => {
    it("records process sampling failures during idle measurement", async () => {
        const run = await runBenchmark({
            readOverrides: { "/proc/4321/status": "Name:\tbasishacks\n" },
        });

        expect(run.error).toBeUndefined();
        expect(run.report.memory_sampling).toMatchObject({ errors: 1, complete: false });
        expect(run.report.app_rss_bytes.sample_count).toBe(0);
        expect(run.report.samples[0]).toMatchObject({ rss_bytes: null, cpu_ticks: null });
        expect(run.exitCode).toBe(1);
    });

    it.each([
        {
            name: "RSS cannot be parsed",
            readOverrides: { "/proc/4321/status": "Name:\tbasishacks\n" },
        },
        {
            name: "cgroup memory cannot be parsed",
            readOverrides: { "/test-data/cgroup-memory": "not-a-number\n" },
        },
    ])("records load sampling failure when $name", async ({ readOverrides }) => {
        const run = await runBenchmark({ mode: "load", readOverrides });

        expect(run.error).toBeUndefined();
        expect(run.report.memory_sampling.errors).toBeGreaterThan(0);
        expect(run.report.memory_sampling.complete).toBe(false);
        expect(run.exitCode).toBe(1);
    });

    it("marks failed requests, over-limit memory, and latency as release failures", async () => {
        const run = await runBenchmark({
            targets: [{ path: "/slow", type: "api", p95LimitMs: 1 }],
            fetchResponses: Array.from({ length: 100 }, () => new Error("network down")),
            extraArgs: ["--memory-limit-bytes", "1"],
        });

        expect(run.report.unexpected_error_rate).toBeGreaterThan(0.001);
        expect(run.report.app_rss_bytes.within_limit).toBe(false);
        expect(run.report.targets[0].within_latency_limit).toBe(false);
        expect(run.exitCode).toBe(1);
    });

    it("enforces memory and cgroup limits during a load run", async () => {
        const run = await runBenchmark({
            mode: "load",
            readOverrides: { "/test-data/cgroup-memory": "700000000\n" },
            extraArgs: ["--memory-limit-bytes", "1", "--cgroup-memory-limit-bytes", "500000000"],
        });

        expect(run.report.app_rss_bytes.within_limit).toBe(false);
        expect(run.report.service_cgroup_memory_bytes.within_limit).toBe(false);
        expect(run.exitCode).toBe(1);
    });

    it("stops on both termination signals and reports incomplete empty measurements", async () => {
        const run = await runBenchmark({
            signals: ["SIGINT", "SIGTERM"],
            performanceStepMs: 1,
        });

        expect(run.signalHandlers.has("SIGINT")).toBe(true);
        expect(run.signalHandlers.has("SIGTERM")).toBe(true);
        expect(run.fetchMock).not.toHaveBeenCalled();
        expect(run.report.request_count).toBe(0);
        expect(run.report.latency_ms).toMatchObject({ p50: null, p95: null, p99: null, max: null });
        expect(run.report.app_rss_bytes.p95).toBeNull();
        expect(run.report.duration_complete).toBe(false);
        expect(run.exitCode).toBe(1);
    });

    it("handles a degenerate histogram bucket count through its max fallback", async () => {
        const run = await runBenchmark({ forcePercentileFallback: true });

        expect(run.error).toBeUndefined();
        expect(run.report.latency_ms.max).toBeGreaterThan(0);
        expect(run.report.latency_ms.p99).toBe(run.report.latency_ms.max);
    });

    it("uses the CPU count fallback when os.availableParallelism is unavailable", async () => {
        const run = await runBenchmark({
            mode: "load",
            noAvailableParallelism: true,
            performanceStepMs: 50,
            extraArgs: ["--users", "1"],
        });

        expect(run.error, String((run.error as Error | undefined)?.stack)).toBeUndefined();
        expect(run.report.app_cpu_percent_of_host).toBeTypeOf("number");
    });

    it.each([
        {
            name: "idle defaults and Bun memory ceiling",
            mode: "idle" as const,
            args: [
                "--mode",
                "idle",
                "--url",
                "https://basishacks.example.test",
                "--pid",
                "4321",
                "--targets",
                targetsPath,
            ],
            expected: {
                runtime: "bun",
                expected_duration_seconds: 300,
                users: 1,
                app_rss_bytes: { limit_bytes: 100663296 },
            },
        },
        {
            name: "Node idle default memory ceiling",
            mode: "idle" as const,
            args: [
                "--mode",
                "idle",
                "--url",
                "https://basishacks.example.test",
                "--pid",
                "4321",
                "--targets",
                targetsPath,
                "--runtime",
                "node",
            ],
            expected: {
                runtime: "node",
                expected_duration_seconds: 300,
                users: 1,
                app_rss_bytes: { limit_bytes: 134217728 },
            },
        },
        {
            name: "load defaults and service memory ceiling",
            mode: "load" as const,
            args: [
                "--mode",
                "load",
                "--url",
                "https://basishacks.example.test",
                "--pid",
                "4321",
                "--targets",
                targetsPath,
                "--cgroup-memory-file",
                "/test-data/cgroup-memory",
                "--database-metrics",
                "/test-data/database-metrics",
            ],
            expected: {
                runtime: "bun",
                expected_duration_seconds: 3600,
                users: 250,
                app_rss_bytes: { limit_bytes: 500000000 },
            },
        },
    ])("applies $name", async ({ mode, args, expected }) => {
        const run = await runBenchmark({ mode, rawArgs: args, signals: ["SIGINT", "SIGTERM"] });

        expect(run.error).toBeUndefined();
        expect(run.report).toMatchObject({
            runtime: expected.runtime,
            expected_duration_seconds: expected.expected_duration_seconds,
            users: expected.users,
        });
        expect(run.report.app_rss_bytes.limit_bytes).toBe(expected.app_rss_bytes.limit_bytes);
        expect(run.exitCode).toBe(1);
    });

    it("compares every baseline metric and a passing N+1 latency target", async () => {
        const run = await runBenchmark({
            targets: [
                {
                    name: "Scores",
                    path: "/api/scores",
                    type: "api",
                    nPlusOne: true,
                    p95LimitMs: 10_000,
                },
            ],
            baseline: {
                throughput_requests_per_second: 12,
                unexpected_error_rate: 0.05,
                latency_ms: { p50: 0, p95: 100_000, p99: 10_000 },
                app_rss_bytes: { p95: 0, max: 2_048 },
                app_cpu_percent_of_host: 10,
                database_metrics: {
                    query_runtime: { p95_ms: 0 },
                    pool_acquire_wait: { p95_ms: 100 },
                },
                targets: [{ name: "Scores", latency_ms: { p95: 100_000 } }],
            },
        });

        expect(run.error).toBeUndefined();
        expect(run.report.baseline_comparison).toMatchObject({
            throughput_requests_per_second: { baseline: 12, candidate: expect.any(Number) },
            unexpected_error_rate: { baseline: 0.05, candidate: 0 },
            latency_ms: {
                p50: { baseline: 0 },
                p95: { baseline: 100_000, candidate: expect.any(Number) },
                p99: { baseline: 10_000, candidate: expect.any(Number) },
            },
            app_rss_bytes: {
                p95: { baseline: 0, candidate: expect.any(Number) },
                max: { baseline: 2_048, candidate: expect.any(Number) },
            },
            database_metrics: {
                query_runtime_p95_ms: { baseline: 0, candidate: null },
                pool_acquire_wait_p95_ms: { baseline: 100, candidate: null },
            },
        });
        expect(run.report.n_plus_one_comparison).toMatchObject([
            {
                name: "Scores",
                reduction_percent: expect.any(Number),
                meets_30_percent_reduction: true,
            },
        ]);
        expect(run.exitCode).toBe(0);
    });

    it("handles absent baseline targets, missing candidate metrics, and failing N+1 comparisons", async () => {
        const run = await runBenchmark({
            targets: [{ name: "Unmatched", path: "/api/results", nPlusOne: true }],
            baseline: {
                latency_ms: {},
                targets: null,
            },
            signals: ["SIGINT"],
            performanceStepMs: 1,
        });

        expect(run.error).toBeUndefined();
        expect(run.report.baseline_comparison).toBeDefined();
        expect(run.report.n_plus_one_comparison).toMatchObject([
            {
                baseline_p95_ms: null,
                candidate_p95_ms: null,
                reduction_percent: null,
                meets_30_percent_reduction: false,
            },
        ]);
        expect(run.exitCode).toBe(1);
    });

    it("returns an empty N+1 comparison when baseline targets have no N+1 match", async () => {
        const run = await runBenchmark({
            targets: [{ name: "Ordinary", path: "/health", nPlusOne: false }],
            baseline: { targets: [] },
        });

        expect(run.error).toBeUndefined();
        expect(run.report.n_plus_one_comparison).toEqual([]);
    });

    it("aggregates in-window metrics and skips malformed, unrelated, and incompatible records", async () => {
        const metric = (overrides: Record<string, unknown>) =>
            JSON.stringify({
                event: "postgres_metrics",
                timestamp: "2026-11-12T00:00:00.000Z",
                ...overrides,
            });
        const commonBounds = [1, 10, 100];
        const logLines = [
            "journald prefix not json",
            JSON.stringify({ event: "other", timestamp: "2026-11-12T00:00:00.000Z" }),
            metric({ timestamp: "invalid timestamp" }),
            metric({ timestamp: "2026-11-11T23:59:59.000Z" }),
            metric({ timestamp: "2026-11-12T00:00:01.000Z" }),
            metric({
                queries: 2,
                query_errors: 1,
                pool_wait_events: 3,
                query_runtime: {
                    bucket_counts: [2, 0, 0],
                    bucket_upper_bounds_ms: commonBounds,
                    count: 2,
                    average_ms: 1,
                    max_ms: 4,
                },
                pool_acquire_wait: {
                    bucket_counts: [1],
                    bucket_upper_bounds_ms: [5],
                    count: 1,
                    average_ms: 2,
                    max_ms: 5,
                },
            }),
            metric({
                queries: 0,
                query_errors: 0,
                pool_wait_events: 0,
                query_runtime: {
                    bucket_counts: [0, 1, 0],
                    bucket_upper_bounds_ms: commonBounds,
                    count: 1,
                    average_ms: 4,
                    max_ms: 8,
                },
                pool_acquire_wait: {
                    bucket_counts: [],
                    bucket_upper_bounds_ms: [],
                    count: 0,
                    average_ms: 0,
                    max_ms: 0,
                },
            }),
            metric({
                queries: 8,
                query_runtime: {
                    bucket_counts: [100, 100],
                    bucket_upper_bounds_ms: [1, 11],
                    count: 100,
                    average_ms: 10,
                    max_ms: 20,
                },
                pool_acquire_wait: { bucket_counts: [2], bucket_upper_bounds_ms: [1, 2] },
            }),
            metric({
                query_runtime: { bucket_counts: [1], bucket_upper_bounds_ms: [1, 2] },
                pool_acquire_wait: null,
            }),
        ];
        const run = await runBenchmark({
            mode: "load",
            targets: [{ path: "/api/results", nPlusOne: false }],
            readOverrides: { "/test-data/database-metrics": logLines.join("\n") },
            extraArgs: ["--users", "1"],
        });

        expect(run.error).toBeUndefined();
        expect(run.report.database_metrics).toMatchObject({
            sample_count: 4,
            queries: 10,
            query_errors: 1,
            pool_wait_events: 3,
            query_runtime: {
                count: 3,
                average_ms: 2,
                p50_ms: 1,
                p95_ms: 10,
                p99_ms: 10,
                max_ms: 8,
            },
            pool_acquire_wait: {
                count: 1,
                average_ms: 2,
                p50_ms: 5,
                p95_ms: 5,
                p99_ms: 5,
                max_ms: 5,
            },
        });
    });

    it("handles empty database histograms and histogram percentile fallback", async () => {
        const metrics = [
            JSON.stringify({
                event: "postgres_metrics",
                timestamp: "2026-11-12T00:00:00.000Z",
                query_runtime: {
                    bucket_counts: [],
                    bucket_upper_bounds_ms: [],
                    count: 0,
                    average_ms: 0,
                    max_ms: 0,
                },
                pool_acquire_wait: {
                    bucket_counts: [1],
                    bucket_upper_bounds_ms: [10],
                    count: 1,
                    average_ms: 1,
                    max_ms: 9,
                },
            }),
        ].join("\n");
        const run = await runBenchmark({
            mode: "load",
            readOverrides: { "/test-data/database-metrics": metrics },
            extraArgs: ["--users", "1"],
            forcePercentileFallback: true,
        });

        expect(run.error).toBeUndefined();
        expect(run.report.database_metrics.query_runtime).toMatchObject({
            count: 0,
            average_ms: null,
            p50_ms: null,
            max_ms: null,
        });
        expect(run.report.database_metrics.pool_acquire_wait).toMatchObject({
            count: 1,
            p50_ms: 9,
            p95_ms: 9,
            max_ms: 9,
        });
    });
});
