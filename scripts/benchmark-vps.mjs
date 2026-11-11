#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const mode = args.mode;
const baseUrl = args.url;
const pid = Number(args.pid);
const targetFile = args.targets;
const runtime = args.runtime ?? "bun";
const durationSeconds = positiveInteger(args.duration ?? (mode === "load" ? "3600" : "300"));
const warmupSeconds = positiveInteger(args.warmup ?? "300");
const users = positiveInteger(args.users ?? "250");
const cgroupMemoryFile = args["cgroup-memory-file"];
const databaseMetricsFile = args["database-metrics"];
const defaultMemoryLimit =
    mode === "idle" ? (runtime === "node" ? "134217728" : "100663296") : "500000000";
const memoryLimitBytes = positiveInteger(args["memory-limit-bytes"] ?? defaultMemoryLimit);
const clockTicksPerSecond = positiveInteger(args["clock-ticks"] ?? "100");

if (!new Set(["idle", "load"]).has(mode)) {
    throw new Error("--mode must be idle or load.");
}
if (!new Set(["bun", "node"]).has(runtime)) throw new Error("--runtime must be bun or node.");
if (!baseUrl) throw new Error("--url is required.");
if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("--pid must be a Linux app process ID.");
if (!targetFile)
    throw new Error("--targets must point to a JSON array of representative requests.");
if (mode === "load" && users < 1) throw new Error("--users must be at least one.");

const targets = JSON.parse(await readFile(targetFile, "utf8"));
if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("The targets file must contain at least one request object.");
}
for (const [index, target] of targets.entries()) validateTarget(target, index);

const extraHeaders = process.env.BENCHMARK_HEADERS_JSON
    ? JSON.parse(process.env.BENCHMARK_HEADERS_JSON)
    : {};
if (!extraHeaders || typeof extraHeaders !== "object" || Array.isArray(extraHeaders)) {
    throw new Error("BENCHMARK_HEADERS_JSON must be a JSON object.");
}

class FixedHistogram {
    buckets;
    count = 0;
    max = 0;

    constructor(bucketCount) {
        this.buckets = new Uint32Array(bucketCount);
    }

    record(milliseconds) {
        const bucket = Math.min(this.buckets.length - 1, Math.ceil(milliseconds));
        this.buckets[bucket] += 1;
        this.count += 1;
        this.max = Math.max(this.max, milliseconds);
    }

    percentile(fraction) {
        if (this.count === 0) return null;
        const target = Math.ceil(this.count * fraction);
        let seen = 0;
        for (let bucket = 0; bucket < this.buckets.length; bucket += 1) {
            seen += this.buckets[bucket];
            if (seen >= target) {
                return bucket === this.buckets.length - 1 ? Math.round(this.max) : bucket;
            }
        }
        return Math.round(this.max);
    }

    summary() {
        return {
            p50: this.percentile(0.5),
            p95: this.percentile(0.95),
            p99: this.percentile(0.99),
            max: this.count ? Math.round(this.max) : null,
        };
    }

    reset() {
        this.buckets.fill(0);
        this.count = 0;
        this.max = 0;
    }
}

const targetMeasurements = targets.map((target, index) => ({
    name: targetName(target, index),
    histogram: new FixedHistogram(10_001),
    requests: 0,
    errors: 0,
}));
const observations = {
    latencyMs: new FixedHistogram(10_001),
    samples: [],
    requests: 0,
    unexpectedErrors: 0,
    statusCounts: new Map(),
};
let measurementStart = performance.now();
let measurementStartedAt = new Date().toISOString();
let stop = false;
const beganAt = new Date().toISOString();

async function sampleProcess() {
    const [status, stat] = await Promise.all([
        readFile(`/proc/${pid}/status`, "utf8"),
        readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (!rssMatch) throw new Error(`Could not read VmRSS for process ${pid}.`);
    const rssBytes = Number(rssMatch[1]) * 1024;
    const statFields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
    const cpuTicks = Number(statFields[11]) + Number(statFields[12]);
    const cgroupMemoryBytes = cgroupMemoryFile
        ? Number((await readFile(cgroupMemoryFile, "utf8")).trim())
        : null;
    if (cgroupMemoryFile && !Number.isSafeInteger(cgroupMemoryBytes)) {
        throw new Error(`Could not read cgroup memory usage from ${cgroupMemoryFile}.`);
    }
    return {
        timestamp: new Date().toISOString(),
        rss_bytes: rssBytes,
        cgroup_memory_bytes: cgroupMemoryBytes,
        cpu_ticks: cpuTicks,
    };
}

async function requestTarget(target, targetIndex) {
    const started = performance.now();
    let status = 0;
    let unexpected = false;
    try {
        const response = await fetch(new URL(target.path, baseUrl), {
            method: target.method ?? "GET",
            headers: { ...extraHeaders, ...(target.headers ?? {}) },
            body: target.body,
            redirect: "manual",
            signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        await response.arrayBuffer();
        const expectedStatuses = target.expectedStatuses ?? [200, 204, 304];
        unexpected = !expectedStatuses.includes(status);
    } catch {
        unexpected = true;
    }
    const elapsed = performance.now() - started;
    observations.requests += 1;
    observations.latencyMs.record(elapsed);
    observations.statusCounts.set(status, (observations.statusCounts.get(status) ?? 0) + 1);
    if (unexpected) observations.unexpectedErrors += 1;
    const targetMetrics = targetMeasurements[targetIndex];
    targetMetrics.requests += 1;
    targetMetrics.histogram.record(elapsed);
    if (unexpected) targetMetrics.errors += 1;
    return { targetIndex, elapsed, status, unexpected };
}

async function runIdle() {
    console.info(`Warm-up: ${warmupSeconds}s; sampled idle: ${durationSeconds}s.`);
    await runRepresentativeTraffic(warmupSeconds, false);
    observations.latencyMs.reset();
    observations.requests = 0;
    observations.unexpectedErrors = 0;
    observations.statusCounts.clear();
    resetTargetMeasurements();
    beginMeasurement();
    await runRepresentativeTraffic(durationSeconds, true);
}

async function runRepresentativeTraffic(seconds, takeSamples) {
    const endAt = performance.now() + seconds * 1_000;
    let targetIndex = 0;
    while (performance.now() < endAt && !stop) {
        const tickStarted = performance.now();
        const target = targets[targetIndex++ % targets.length];
        const measurements = await Promise.all([
            requestTarget(target, targetIndex - 1),
            ...(takeSamples ? [sampleProcess()] : []),
        ]);
        if (takeSamples) {
            const sample = measurements[1];
            observations.samples.push(sample);
        }
        const delay = Math.max(0, 1_000 - (performance.now() - tickStarted));
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

async function runLoad() {
    console.info(`Warm-up: ${warmupSeconds}s; load: ${users} users for ${durationSeconds}s.`);
    await runRepresentativeTraffic(warmupSeconds, false);
    observations.latencyMs.reset();
    observations.requests = 0;
    observations.unexpectedErrors = 0;
    observations.statusCounts.clear();
    resetTargetMeasurements();
    beginMeasurement();

    const deadline = performance.now() + durationSeconds * 1_000;
    const sampler = (async () => {
        while (performance.now() < deadline && !stop) {
            try {
                observations.samples.push(await sampleProcess());
            } catch {
                observations.samples.push({
                    timestamp: new Date().toISOString(),
                    rss_bytes: null,
                    cpu_ticks: null,
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    })();

    let nextTarget = 0;
    const workers = Array.from({ length: users }, async () => {
        while (performance.now() < deadline && !stop) {
            const targetIndex = nextTarget++ % targets.length;
            await requestTarget(targets[targetIndex], targetIndex);
        }
    });
    await Promise.all([...workers, sampler]);
}

process.on("SIGINT", () => {
    stop = true;
});
process.on("SIGTERM", () => {
    stop = true;
});

if (mode === "idle") await runIdle();
else await runLoad();
const elapsedSeconds = (performance.now() - measurementStart) / 1_000;
const finishedAt = new Date().toISOString();
const rssSamples = observations.samples
    .map((sample) => sample.rss_bytes)
    .filter((value) => typeof value === "number");
const rssP95 = percentile(rssSamples, 0.95);
const rssMax = rssSamples.length ? Math.max(...rssSamples) : null;
const cpuSamples = observations.samples.filter((sample) => typeof sample.cpu_ticks === "number");
const cpuCount =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const cpuPercent =
    cpuSamples.length > 1
        ? ((cpuSamples.at(-1).cpu_ticks - cpuSamples[0].cpu_ticks) /
              clockTicksPerSecond /
              Math.max(
                  1,
                  (Date.parse(cpuSamples.at(-1).timestamp) - Date.parse(cpuSamples[0].timestamp)) /
                      1_000,
              ) /
              cpuCount) *
          100
        : null;
const report = {
    mode,
    runtime,
    started_at: beganAt,
    measurement_started_at: measurementStartedAt,
    finished_at: finishedAt,
    duration_seconds: Math.round(elapsedSeconds),
    users: mode === "load" ? users : 1,
    app_pid: pid,
    request_count: observations.requests,
    throughput_requests_per_second: round(observations.requests / elapsedSeconds, 2),
    unexpected_error_rate: observations.requests
        ? round(observations.unexpectedErrors / observations.requests, 5)
        : null,
    latency_ms: observations.latencyMs.summary(),
    app_rss_bytes: {
        sample_count: rssSamples.length,
        p95: rssP95,
        max: rssMax,
        limit_bytes: memoryLimitBytes,
        within_limit:
            mode === "idle"
                ? rssP95 !== null && rssP95 <= memoryLimitBytes
                : rssMax !== null && rssMax < memoryLimitBytes,
    },
    service_cgroup_memory_bytes: summarizeCgroupMemory(observations.samples, memoryLimitBytes),
    app_cpu_percent_of_host: cpuPercent === null ? null : round(cpuPercent, 2),
    statuses: Object.fromEntries(observations.statusCounts),
    targets: targets.map((target, index) => {
        const metrics = targetMeasurements[index];
        const p95LimitMs =
            target.p95LimitMs ??
            (target.type === "report" ? 1_000 : target.type === "api" ? 500 : null);
        return {
            name: metrics.name,
            requests: metrics.requests,
            unexpected_errors: metrics.errors,
            latency_ms: metrics.histogram.summary(),
            p95_limit_ms: p95LimitMs,
            n_plus_one: target.nPlusOne === true,
            within_latency_limit:
                p95LimitMs === null ||
                (metrics.histogram.percentile(0.95) !== null &&
                    metrics.histogram.percentile(0.95) <= p95LimitMs),
        };
    }),
    database_metrics: await readDatabaseMetrics(
        databaseMetricsFile,
        measurementStartedAt,
        finishedAt,
    ),
    samples: observations.samples,
};
if (args.baseline) {
    const baseline = JSON.parse(await readFile(args.baseline, "utf8"));
    report.baseline_comparison = compareReports(baseline, report);
    const baselineTargets = new Map(
        (baseline.targets ?? []).map((target) => [target.name, target]),
    );
    report.n_plus_one_comparison = report.targets
        .filter((target) => target.n_plus_one)
        .map((target) => {
            const previous = baselineTargets.get(target.name);
            const before = previous?.latency_ms?.p95;
            const after = target.latency_ms.p95;
            const reductionPercent =
                typeof before === "number" && before > 0 && typeof after === "number"
                    ? round(((before - after) / before) * 100, 2)
                    : null;
            return {
                name: target.name,
                baseline_p95_ms: before ?? null,
                candidate_p95_ms: after,
                reduction_percent: reductionPercent,
                meets_30_percent_reduction: reductionPercent !== null && reductionPercent >= 30,
            };
        });
}
const output = JSON.stringify(report, null, 2);
if (args.output) await writeFile(args.output, `${output}\n`, "utf8");
console.log(output);

if (report.unexpected_error_rate > 0.001) process.exitCode = 1;
if (mode === "load" && !report.app_rss_bytes.within_limit) process.exitCode = 1;
if (mode === "idle" && !report.app_rss_bytes.within_limit) process.exitCode = 1;
if (report.targets.some((target) => !target.within_latency_limit)) process.exitCode = 1;
if (report.n_plus_one_comparison?.some((target) => !target.meets_30_percent_reduction)) {
    process.exitCode = 1;
}
if (report.service_cgroup_memory_bytes && !report.service_cgroup_memory_bytes.within_limit) {
    process.exitCode = 1;
}
if (cgroupMemoryFile && !report.service_cgroup_memory_bytes) {
    console.error(`No cgroup memory samples could be read from ${cgroupMemoryFile}.`);
    process.exitCode = 1;
}
if (databaseMetricsFile && report.database_metrics.sample_count === 0) {
    console.error(`No in-window postgres_metrics lines found in ${databaseMetricsFile}.`);
    process.exitCode = 1;
}

function beginMeasurement() {
    measurementStart = performance.now();
    measurementStartedAt = new Date().toISOString();
}

function parseArgs(rawArgs) {
    const result = {};
    for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];
        if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        const value = rawArgs[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
        result[key] = value;
        index += 1;
    }
    return result;
}

function positiveInteger(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error(`Expected a positive integer: ${value}`);
    return parsed;
}

function validateTarget(target, index) {
    if (!target || typeof target !== "object" || typeof target.path !== "string") {
        throw new Error(`Target ${index} must be an object with a path string.`);
    }
    const method = (target.method ?? "GET").toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new Error(`Target ${index} has an invalid HTTP method.`);
    if (!new Set(["GET", "HEAD"]).has(method) && args["allow-mutations"] !== "true") {
        throw new Error(
            `Target ${index} uses ${method}. Add --allow-mutations true only for a disposable test environment.`,
        );
    }
    if (target.body !== undefined && !["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error(`Target ${index} has a body on a non-mutating method.`);
    }
    if (
        target.headers !== undefined &&
        (!target.headers || typeof target.headers !== "object" || Array.isArray(target.headers))
    ) {
        throw new Error(`Target ${index} headers must be an object.`);
    }
    if (
        target.expectedStatuses !== undefined &&
        (!Array.isArray(target.expectedStatuses) ||
            target.expectedStatuses.some(
                (status) => !Number.isInteger(status) || status < 100 || status > 599,
            ))
    ) {
        throw new Error(`Target ${index} expectedStatuses must be an array of HTTP status codes.`);
    }
    if (
        target.p95LimitMs !== undefined &&
        (!Number.isFinite(target.p95LimitMs) || target.p95LimitMs <= 0)
    ) {
        throw new Error(`Target ${index} p95LimitMs must be a positive number.`);
    }
    if (
        target.name !== undefined &&
        (typeof target.name !== "string" || target.name.length === 0)
    ) {
        throw new Error(`Target ${index} name must be a non-empty string.`);
    }
    if (target.type !== undefined && !new Set(["page", "api", "report"]).has(target.type)) {
        throw new Error(`Target ${index} type must be page, api, or report.`);
    }
    if (target.nPlusOne !== undefined && typeof target.nPlusOne !== "boolean") {
        throw new Error(`Target ${index} nPlusOne must be a boolean.`);
    }
}

function targetName(target, index) {
    return target.name ?? `${(target.method ?? "GET").toUpperCase()} ${target.path} [${index + 1}]`;
}

function resetTargetMeasurements() {
    for (const target of targetMeasurements) {
        target.histogram.reset();
        target.requests = 0;
        target.errors = 0;
    }
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function percentile(values, fraction) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeCgroupMemory(samples, limitBytes) {
    const values = samples
        .map((sample) => sample.cgroup_memory_bytes)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!values.length) return null;
    return {
        sample_count: values.length,
        p95: percentile(values, 0.95),
        max: Math.max(...values),
        limit_bytes: limitBytes,
        within_limit: Math.max(...values) < limitBytes,
    };
}

async function readDatabaseMetrics(file, start, end) {
    if (!file) return null;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    const entries = [];
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            const timestamp = Date.parse(entry.timestamp);
            if (
                entry.event === "postgres_metrics" &&
                Number.isFinite(timestamp) &&
                timestamp >= Date.parse(start) &&
                timestamp <= Date.parse(end)
            ) {
                entries.push(entry);
            }
        } catch {
            // Journald prefixes and unrelated service log lines are ignored.
        }
    }

    return {
        source: file,
        sample_count: entries.length,
        queries: entries.reduce((sum, entry) => sum + Number(entry.queries || 0), 0),
        query_errors: entries.reduce((sum, entry) => sum + Number(entry.query_errors || 0), 0),
        pool_wait_events: entries.reduce(
            (sum, entry) => sum + Number(entry.pool_wait_events || 0),
            0,
        ),
        query_runtime: mergeDatabaseHistograms(entries.map((entry) => entry.query_runtime)),
        pool_acquire_wait: mergeDatabaseHistograms(entries.map((entry) => entry.pool_acquire_wait)),
    };
}

function mergeDatabaseHistograms(histograms) {
    const valid = histograms.filter(
        (histogram) =>
            Array.isArray(histogram?.bucket_counts) &&
            Array.isArray(histogram?.bucket_upper_bounds_ms) &&
            histogram.bucket_counts.length === histogram.bucket_upper_bounds_ms.length,
    );
    if (!valid.length) return null;

    const bounds = valid[0].bucket_upper_bounds_ms;
    const counts = Array(bounds.length).fill(0);
    let count = 0;
    let weightedSum = 0;
    let max = 0;
    for (const histogram of valid) {
        if (histogram.bucket_upper_bounds_ms.some((bound, index) => bound !== bounds[index])) {
            continue;
        }
        for (let index = 0; index < counts.length; index += 1) {
            counts[index] += Number(histogram.bucket_counts[index] || 0);
        }
        count += Number(histogram.count || 0);
        weightedSum += Number(histogram.average_ms || 0) * Number(histogram.count || 0);
        max = Math.max(max, Number(histogram.max_ms || 0));
    }

    return {
        count,
        average_ms: count ? round(weightedSum / count, 2) : null,
        p50_ms: histogramPercentile(counts, bounds, 0.5, max),
        p95_ms: histogramPercentile(counts, bounds, 0.95, max),
        p99_ms: histogramPercentile(counts, bounds, 0.99, max),
        max_ms: count ? max : null,
    };
}

function histogramPercentile(counts, bounds, fraction, max) {
    const count = counts.reduce((sum, value) => sum + value, 0);
    if (!count) return null;
    const target = Math.ceil(count * fraction);
    let seen = 0;
    for (let index = 0; index < counts.length; index += 1) {
        seen += counts[index];
        if (seen >= target) {
            return index === counts.length - 1 ? max : bounds[index];
        }
    }
    return max;
}

function compareReports(baseline, candidate) {
    const compare = (before, after) => ({
        baseline: before ?? null,
        candidate: after ?? null,
        change_percent:
            typeof before === "number" && before !== 0 && typeof after === "number"
                ? round(((after - before) / Math.abs(before)) * 100, 2)
                : null,
    });
    return {
        throughput_requests_per_second: compare(
            baseline.throughput_requests_per_second,
            candidate.throughput_requests_per_second,
        ),
        unexpected_error_rate: compare(
            baseline.unexpected_error_rate,
            candidate.unexpected_error_rate,
        ),
        latency_ms: Object.fromEntries(
            ["p50", "p95", "p99"].map((key) => [
                key,
                compare(baseline.latency_ms?.[key], candidate.latency_ms?.[key]),
            ]),
        ),
        app_rss_bytes: {
            p95: compare(baseline.app_rss_bytes?.p95, candidate.app_rss_bytes?.p95),
            max: compare(baseline.app_rss_bytes?.max, candidate.app_rss_bytes?.max),
        },
        app_cpu_percent_of_host: compare(
            baseline.app_cpu_percent_of_host,
            candidate.app_cpu_percent_of_host,
        ),
        database_metrics: {
            query_runtime_p95_ms: compare(
                baseline.database_metrics?.query_runtime?.p95_ms,
                candidate.database_metrics?.query_runtime?.p95_ms,
            ),
            pool_acquire_wait_p95_ms: compare(
                baseline.database_metrics?.pool_acquire_wait?.p95_ms,
                candidate.database_metrics?.pool_acquire_wait?.p95_ms,
            ),
        },
    };
}
