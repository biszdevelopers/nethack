#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const command = args.command;
const commandArgs = JSON.parse(args.args ?? "[]");
const systemdUnit = args["systemd-unit"];
const url = args.url;
const runs = positiveInteger(args.runs ?? "5");
const timeoutMs = positiveInteger(args["timeout-ms"] ?? "60000");
const memoryLimitBytes = positiveInteger(args["memory-limit-bytes"] ?? "500000000");
const cgroupMemoryFile = args["cgroup-memory-file"];

if (process.platform !== "linux") {
    throw new Error("Cold-start measurement requires Linux /proc process statistics.");
}
if (
    Boolean(command) === Boolean(systemdUnit) ||
    !url ||
    !Array.isArray(commandArgs) ||
    commandArgs.some((value) => typeof value !== "string")
) {
    throw new Error("Provide either --command with --args, or --systemd-unit, and provide --url.");
}
if (systemdUnit && !/^[A-Za-z0-9_.@:-]+\.service$/.test(systemdUnit)) {
    throw new Error("--systemd-unit must be a systemd service unit name ending in .service.");
}
if (systemdUnit && !cgroupMemoryFile) {
    throw new Error("--systemd-unit requires --cgroup-memory-file for service memory sampling.");
}

const results = [];
for (let run = 1; run <= runs; run += 1) {
    results.push(await measureColdStart(run));
}

const successfulStarts = results.filter((result) => result.ready);
const startupTimes = successfulStarts.map((result) => result.startup_ms);
const appRssMax = maximum(results.map((result) => result.process_rss_max_bytes));
const cgroupMax = maximum(results.map((result) => result.cgroup_memory_max_bytes));
const report = {
    mode: "cold-start",
    command: systemdUnit ? `systemctl start ${systemdUnit}` : `${command} ${commandArgs.join(" ")}`,
    url,
    started_at: results[0]?.started_at ?? new Date().toISOString(),
    run_count: runs,
    successful_starts: successfulStarts.length,
    startup_ms: {
        p50: percentile(startupTimes, 0.5),
        p95: percentile(startupTimes, 0.95),
        max: maximum(startupTimes),
    },
    process_rss_bytes: {
        max: appRssMax,
        limit_bytes: memoryLimitBytes,
        within_limit: appRssMax !== null && appRssMax < memoryLimitBytes,
    },
    service_cgroup_memory_bytes: cgroupMemoryFile
        ? {
              source: cgroupMemoryFile,
              max: cgroupMax,
              limit_bytes: memoryLimitBytes,
              within_limit: cgroupMax !== null && cgroupMax < memoryLimitBytes,
          }
        : null,
    runs: results,
};
const output = JSON.stringify(report, null, 2);
if (args.output) await writeFile(args.output, `${output}\n`, "utf8");
console.log(output);
if (successfulStarts.length !== runs || !report.process_rss_bytes.within_limit) {
    process.exitCode = 1;
}
if (report.service_cgroup_memory_bytes && !report.service_cgroup_memory_bytes.within_limit) {
    process.exitCode = 1;
}

async function measureColdStart(run) {
    if (systemdUnit) {
        const stopped = await runProcess("systemctl", ["stop", systemdUnit]);
        if (stopped.code !== 0) {
            return failedSystemdRun(run, `Could not stop ${systemdUnit}: ${stopped.stderr}`);
        }
    }

    const startedAt = new Date().toISOString();
    const started = performance.now();
    let child;
    let childError;
    let exited;
    if (systemdUnit) {
        const startResult = await runProcess("systemctl", ["start", systemdUnit]);
        if (startResult.code !== 0) {
            childError = `Could not start ${systemdUnit}: ${startResult.stderr}`;
            exited = true;
        }
    } else {
        child = spawn(command, commandArgs, {
            cwd: args.cwd ?? process.cwd(),
            env: process.env,
            stdio: "ignore",
            shell: false,
        });
        child.once("error", (error) => {
            childError = error.message;
            exited = true;
        });
        child.once("exit", (code, signal) => {
            exited = true;
            if (code !== 0) childError ??= `Process exited with code ${code ?? signal}.`;
        });
    }

    let ready = false;
    let lastStatus = null;
    let processRssMaxBytes = 0;
    let processRssSampleCount = 0;
    let cgroupMemoryMaxBytes = null;
    let sampleCount = 0;
    let lastPidReadAt = 0;
    let observedPid = systemdUnit ? null : child.pid;
    const deadline = started + timeoutMs;
    while (!exited && performance.now() < deadline) {
        try {
            if (systemdUnit && performance.now() - lastPidReadAt >= 250) {
                const pidResult = await runProcess("systemctl", [
                    "show",
                    "--property=MainPID",
                    "--value",
                    systemdUnit,
                ]);
                observedPid = pidResult.code === 0 ? Number(pidResult.stdout.trim()) || null : null;
                lastPidReadAt = performance.now();
            }
            if (observedPid) {
                const status = await readFile(`/proc/${observedPid}/status`, "utf8");
                const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
                if (match) {
                    processRssMaxBytes = Math.max(processRssMaxBytes, Number(match[1]) * 1024);
                    processRssSampleCount += 1;
                }
            }
            if (cgroupMemoryFile) {
                const value = Number((await readFile(cgroupMemoryFile, "utf8")).trim());
                if (!Number.isSafeInteger(value)) throw new Error("Invalid cgroup memory value");
                cgroupMemoryMaxBytes = Math.max(cgroupMemoryMaxBytes ?? 0, value);
            }
            sampleCount += 1;
        } catch (error) {
            if (cgroupMemoryFile && !String(error).includes("ENOENT")) childError ??= String(error);
        }

        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(1_000),
                redirect: "manual",
            });
            lastStatus = response.status;
            await response.body?.cancel();
            ready = response.status >= 200 && response.status < 400;
        } catch {
            // The server is not ready yet; keep sampling until it starts or times out.
        }
        if (ready || exited) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const startupMs = ready ? Math.round((performance.now() - started) * 100) / 100 : null;
    if (systemdUnit) {
        try {
            const value = Number((await readFile(cgroupMemoryFile, "utf8")).trim());
            if (Number.isSafeInteger(value))
                cgroupMemoryMaxBytes = Math.max(cgroupMemoryMaxBytes ?? 0, value);
        } catch {
            // The summary below fails when no cgroup memory samples were collected.
        }
        const stopped = await runProcess("systemctl", ["stop", systemdUnit]);
        if (stopped.code !== 0) childError ??= `Could not stop ${systemdUnit}: ${stopped.stderr}`;
    } else if (!exited) {
        await stopChild(child);
    }
    return {
        run,
        started_at: startedAt,
        ready,
        startup_ms: startupMs,
        last_http_status: lastStatus,
        sample_count: sampleCount,
        process_rss_max_bytes: processRssSampleCount ? processRssMaxBytes : null,
        cgroup_memory_max_bytes: cgroupMemoryMaxBytes,
        error: childError ?? (ready ? null : `Server did not become ready within ${timeoutMs} ms.`),
    };
}

async function failedSystemdRun(run, error) {
    return {
        run,
        started_at: new Date().toISOString(),
        ready: false,
        startup_ms: null,
        last_http_status: null,
        sample_count: 0,
        process_rss_max_bytes: null,
        cgroup_memory_max_bytes: null,
        error,
    };
}

async function runProcess(commandName, commandArgs) {
    return await new Promise((resolve) => {
        const childProcess = spawn(commandName, commandArgs, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        childProcess.stdout.setEncoding("utf8").on("data", (value) => (stdout += value));
        childProcess.stderr.setEncoding("utf8").on("data", (value) => (stderr += value));
        childProcess.once("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
        childProcess.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

async function stopChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        timer.unref();
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function parseArgs(rawArgs) {
    const parsed = {};
    for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];
        if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        const value = rawArgs[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
        parsed[key] = value;
        index += 1;
    }
    return parsed;
}

function positiveInteger(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error(`Expected a positive integer: ${value}`);
    return parsed;
}

function maximum(values) {
    return values.length ? Math.max(...values) : null;
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
