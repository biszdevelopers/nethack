import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    buildReport,
    createRuntime,
    parseArgs,
    percentile,
    positiveInteger,
    runIfDirect,
    runBenchmark,
    runProcess,
    stopChild,
} from "../../scripts/benchmark-startup.mjs";

function fakeRuntime({
    platform = "linux",
    nowValues = [100, 110, 120, 130, 140],
    statusText = "Name:\tservice\nVmRSS:\t12 kB\n",
    cgroupValue = "900\n",
    responseStatus = 200,
    responseBody = { cancel: async () => {} },
    fetchError,
    systemdResults = [],
    readError,
    childMode,
} = {}) {
    let clockIndex = 0;
    let lastClockValue = nowValues.at(-1) ?? 0;
    const calls = [];
    const written = [];
    const logged = [];
    const runtime = {
        platform,
        env: { FIXTURE: "test" },
        cwd: () => "/fixture/cwd",
        now: () => {
            if (clockIndex < nowValues.length) return nowValues[clockIndex++];
            lastClockValue += 1_000;
            return lastClockValue;
        },
        isoNow: () => "2026-11-13T00:00:00.000Z",
        sleep: async () => {},
        readFile: async (path) => {
            calls.push(["readFile", path]);
            if (readError) throw readError;
            if (path.startsWith("/proc/")) return statusText;
            return cgroupValue;
        },
        writeFile: async (...args) => written.push(args),
        fetch: async () => {
            if (fetchError) throw fetchError;
            return { status: responseStatus, body: responseBody };
        },
        log: (value) => logged.push(value),
        setExitCode: (value) => calls.push(["setExitCode", value]),
        setTimeout: (callback) => {
            const timer = { unref: () => {} };
            callback();
            return timer;
        },
        clearTimeout: () => {},
        spawn: (command, args, options) => {
            calls.push(["spawn", command, args, options]);
            if (command === "systemctl") {
                const streams = [new PassThrough(), new PassThrough()];
                const child = new EventEmitter();
                child.stdout = streams[0];
                child.stderr = streams[1];
                child.exitCode = null;
                child.signalCode = null;
                const result = systemdResults.shift() ?? { code: 0, stdout: "" };
                queueMicrotask(() => {
                    streams[0].end(result.stdout ?? "");
                    streams[1].end(result.stderr ?? "");
                    child.exitCode = result.code ?? 0;
                    child.emit("exit", child.exitCode);
                });
                return child;
            }
            const child = new EventEmitter();
            child.pid = 321;
            child.exitCode = null;
            child.signalCode = null;
            if (childMode === "error") {
                queueMicrotask(() => child.emit("error", new Error("spawn denied")));
                return child;
            }
            if (childMode === "exit") {
                child.exitCode = 7;
                queueMicrotask(() => child.emit("exit", 7, null));
                return child;
            }
            if (childMode === "signal") {
                queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
                return child;
            }
            child.kill = (signal) => {
                child.signalCode = signal;
                queueMicrotask(() => child.emit("exit", null, signal));
                return true;
            };
            return child;
        },
    };
    return { runtime, calls, written, logged };
}

describe("startup benchmark argument and report helpers", () => {
    it("creates default adapters and accepts runtime overrides", async () => {
        const runtime = createRuntime();
        expect(runtime.platform).toBe(process.platform);
        expect(runtime.cwd()).toBe(process.cwd());
        expect(Number.isFinite(runtime.now())).toBe(true);
        expect(Number.isNaN(Date.parse(runtime.isoNow()))).toBe(false);
        await runtime.sleep(0);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        runtime.log("isolated benchmark log");
        expect(logSpy).toHaveBeenCalledWith("isolated benchmark log");
        logSpy.mockRestore();
        const originalExitCode = process.exitCode;
        runtime.setExitCode(0);
        process.exitCode = originalExitCode;

        const overrides = {
            platform: "test-platform",
            env: { FIXTURE: "override" },
            cwd: () => "/fixture/override",
            spawn: () => "spawn",
            readFile: async () => "read",
            writeFile: async () => "write",
            fetch: async () => "fetch",
            now: () => 1,
            isoNow: () => "timestamp",
            sleep: async () => "sleep",
            log: () => "log",
            setTimeout: () => "timer",
            clearTimeout: () => "clear",
            setExitCode: () => "exit",
        };
        const overridden = createRuntime(overrides);
        expect(overridden.platform).toBe("test-platform");
        expect(overridden.cwd()).toBe("/fixture/override");
        expect(overridden.spawn()).toBe("spawn");
        await expect(overridden.readFile()).resolves.toBe("read");
        await expect(overridden.writeFile()).resolves.toBe("write");
        await expect(overridden.fetch()).resolves.toBe("fetch");
        expect(overridden.now()).toBe(1);
        expect(overridden.isoNow()).toBe("timestamp");
        await expect(overridden.sleep()).resolves.toBe("sleep");
        expect(overridden.log()).toBe("log");
        expect(overridden.setTimeout()).toBe("timer");
        expect(overridden.clearTimeout()).toBe("clear");
        expect(overridden.setExitCode()).toBe("exit");
    });

    it("uses the default process, file, and fetch adapters for isolated operations", async () => {
        const runtime = createRuntime();
        const command = await runProcess(
            process.execPath,
            ["-e", "process.stdout.write('ready')"],
            runtime,
        );
        expect(command).toMatchObject({ code: 0, stdout: "ready", stderr: "" });
        const executableBytes = await runtime.readFile(process.execPath);
        expect(executableBytes.length).toBeGreaterThan(0);
        const directory = join(process.cwd(), ".tmp-vitest", "cli-default-runtime");
        const path = join(directory, `output-${process.pid}.txt`);
        await mkdir(directory, { recursive: true });
        try {
            await runtime.writeFile(path, "isolated", "utf8");
            await expect(readFile(path, "utf8")).resolves.toBe("isolated");
        } finally {
            await rm(path, { force: true });
        }
        const response = await runtime.fetch("data:text/plain,fixture");
        expect(await response.text()).toBe("fixture");
    });

    it("resolves a child-process spawn error in the process runner", async () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        const runtime = { spawn: () => child };
        const result = runProcess("fixture", [], runtime);
        queueMicrotask(() => child.emit("error", new Error("process launch failed")));
        await expect(result).resolves.toEqual({
            code: 1,
            stdout: "",
            stderr: "process launch failed",
        });
    });

    it("uses a failure exit code when a process exits from a signal", async () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        const result = runProcess("fixture", [], { spawn: () => child });
        queueMicrotask(() => child.emit("exit", null));
        await expect(result).resolves.toEqual({ code: 1, stdout: "", stderr: "" });
    });

    it("parses paired CLI values and rejects malformed arguments", () => {
        expect(parseArgs(["--url", "http://localhost", "--runs", "2"])).toEqual({
            url: "http://localhost",
            runs: "2",
        });
        expect(() => parseArgs(["unexpected"])).toThrow("Unexpected argument");
        expect(() => parseArgs(["--url", "--runs", "2"])).toThrow("Missing value for --url");
    });

    it("validates positive safe integers", () => {
        expect(positiveInteger("4")).toBe(4);
        for (const input of ["0", "-1", "1.5", "not-a-number", "9007199254740992"]) {
            expect(() => positiveInteger(input)).toThrow("Expected a positive integer");
        }
    });

    it("calculates bounded percentiles and handles empty samples", () => {
        expect(percentile([], 0.95)).toBeNull();
        expect(percentile([10, 4, 7], 0.5)).toBe(7);
        expect(percentile([10, 4, 7], 1)).toBe(10);
    });

    it("builds reports for empty, successful, and systemd measurements", () => {
        const options = {
            command: "node",
            commandArgs: ["server.mjs"],
            runs: 1,
            url: "http://127.0.0.1:3000/health",
            memoryLimitBytes: 1_000,
        };
        const empty = buildReport([], options);
        expect(empty.startup_ms).toEqual({ p50: null, p95: null, max: null });
        expect(empty.process_rss_bytes.within_limit).toBe(false);
        const success = buildReport(
            [
                {
                    ready: true,
                    startup_ms: 18,
                    started_at: "2026-11-13T00:00:00.000Z",
                    process_rss_max_bytes: 500,
                    cgroup_memory_max_bytes: 700,
                },
            ],
            { ...options, cgroupMemoryFile: "/fixture/cgroup/memory.current" },
        );
        expect(success.command).toBe("node server.mjs");
        expect(success.startup_ms).toEqual({ p50: 18, p95: 18, max: 18 });
        expect(success.process_rss_bytes.within_limit).toBe(true);
        expect(success.service_cgroup_memory_bytes.within_limit).toBe(true);
        const systemd = buildReport([], { ...options, systemdUnit: "basishacks.service" });
        expect(systemd.command).toBe("systemctl start basishacks.service");
    });
});

describe("startup benchmark execution paths", () => {
    const base = ["--command", "node", "--args", '["server.mjs"]', "--url", "http://localhost"];

    it("runs only when its module URL matches the executable path", async () => {
        const moduleUrl = new URL("../../scripts/benchmark-startup.mjs", import.meta.url).href;
        const executablePath = fileURLToPath(moduleUrl);
        const imported = fakeRuntime();
        await expect(runIfDirect(moduleUrl, undefined, base, imported.runtime)).resolves.toBeNull();
        await expect(
            runIfDirect(moduleUrl, "/different/script.mjs", base, imported.runtime),
        ).resolves.toBeNull();
        await expect(runIfDirect(moduleUrl, executablePath, base, imported.runtime)).resolves.toBe(
            0,
        );
        expect(imported.calls).toContainEqual(["setExitCode", 0]);
    });

    it("rejects non-Linux execution before launching a target", async () => {
        const { runtime, calls } = fakeRuntime({ platform: "win32" });
        await expect(runBenchmark(base, runtime)).rejects.toThrow("requires Linux /proc");
        expect(calls).toEqual([]);
    });

    it.each([
        [[], "Provide either"],
        [["--url", "http://localhost"], "Provide either"],
        [["--command", "node", "--args", "{}", "--url", "http://localhost"], "Provide either"],
        [["--command", "node", "--args", "[1]", "--url", "http://localhost"], "Provide either"],
        [["--systemd-unit", "bad unit", "--url", "http://localhost"], "systemd service unit"],
        [
            ["--systemd-unit", "app.service", "--url", "http://localhost"],
            "requires --cgroup-memory-file",
        ],
    ])("rejects invalid measurement options %j", async (args, message) => {
        await expect(runBenchmark(args, fakeRuntime().runtime)).rejects.toThrow(message);
    });

    it("samples a child process, records RSS, writes the report, and stops it after readiness", async () => {
        const { runtime, calls, written, logged } = fakeRuntime();
        const { report, exitCode } = await runBenchmark(
            [...base, "--runs", "1", "--output", "result.json"],
            runtime,
        );
        expect(exitCode).toBe(0);
        expect(report.successful_starts).toBe(1);
        expect(report.runs[0]).toMatchObject({
            ready: true,
            last_http_status: 200,
            process_rss_max_bytes: 12 * 1024,
            cgroup_memory_max_bytes: null,
        });
        expect(calls[0][1]).toBe("node");
        expect(written[0][0]).toBe("result.json");
        expect(logged).toHaveLength(1);
    });

    it("uses an explicit working directory and handles startup spawn and exit errors", async () => {
        const withCwd = fakeRuntime();
        await runBenchmark([...base, "--cwd", "/fixture/explicit"], withCwd.runtime);
        expect(withCwd.calls[0][3].cwd).toBe("/fixture/explicit");

        for (const [childMode, expected] of [
            ["error", "spawn denied"],
            ["exit", "Process exited with code 7."],
            ["signal", "Process exited with code SIGKILL."],
        ]) {
            const { runtime } = fakeRuntime({
                childMode,
                fetchError: new Error("connection refused"),
            });
            const result = await runBenchmark([...base, "--runs", "1"], runtime);
            expect(result.exitCode, childMode).toBe(1);
            expect(result.report.runs[0].error).toBe(expected);
        }
    });

    it("force-kills a child that ignores SIGTERM and skips children that already exited", async () => {
        const killed = [];
        const child = new EventEmitter();
        child.exitCode = null;
        child.signalCode = null;
        child.kill = (signal) => killed.push(signal);
        const { runtime } = fakeRuntime();
        await stopChild(child, runtime);
        expect(killed).toEqual(["SIGTERM", "SIGKILL"]);

        child.exitCode = 0;
        killed.length = 0;
        await stopChild(child, runtime);
        expect(killed).toEqual([]);
    });

    it("reports startup timeouts and exits unsuccessfully when the endpoint never responds", async () => {
        const { runtime } = fakeRuntime({ fetchError: new Error("connection refused") });
        let clock = 0;
        runtime.now = () => (clock += 25);
        runtime.sleep = async () => {};
        const { report, exitCode } = await runBenchmark(
            [...base, "--runs", "1", "--timeout-ms", "100"],
            runtime,
        );
        expect(exitCode).toBe(1);
        expect(report.runs[0]).toMatchObject({
            ready: false,
            startup_ms: null,
            last_http_status: null,
            error: "Server did not become ready within 100 ms.",
        });
    });

    it("records bad HTTP statuses and enforces the process memory ceiling", async () => {
        const { runtime } = fakeRuntime({ responseStatus: 500 });
        const { report, exitCode } = await runBenchmark(
            [...base, "--runs", "1", "--memory-limit-bytes", "100"],
            runtime,
        );
        expect(exitCode).toBe(1);
        expect(report.runs[0].last_http_status).toBe(500);
        expect(report.process_rss_bytes.within_limit).toBe(false);
    });

    it("supports a systemd unit and checks process and cgroup memory", async () => {
        const systemdArgs = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
        ];
        const { runtime, calls } = fakeRuntime({
            nowValues: [0, 300, 310, 320, 330, 340, 350, 360],
            systemdResults: [{ code: 0 }, { code: 0 }, { code: 0, stdout: "321\n" }, { code: 0 }],
        });
        const { report, exitCode } = await runBenchmark(systemdArgs, runtime);
        expect(exitCode).toBe(0);
        expect(report.command).toBe("systemctl start basishacks.service");
        expect(report.service_cgroup_memory_bytes.max).toBe(900);
        expect(report.runs[0].process_rss_max_bytes).toBe(12 * 1024);
        expect(calls.filter((call) => call[0] === "spawn").map((call) => call[2][0])).toEqual([
            "stop",
            "start",
            "show",
            "stop",
        ]);
    });

    it("handles missing systemd PIDs and process status without RSS", async () => {
        const args = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
        ];
        const noPid = fakeRuntime({
            nowValues: [0, 300, 310, 320, 330],
            systemdResults: [{ code: 0 }, { code: 0 }, { code: 1, stdout: "321\n" }, { code: 0 }],
        });
        const first = await runBenchmark(args, noPid.runtime);
        expect(first.report.runs[0].process_rss_max_bytes).toBeNull();
        expect(
            noPid.calls.some((call) => call[0] === "readFile" && call[1].startsWith("/proc/")),
        ).toBe(false);

        const zeroPid = fakeRuntime({
            nowValues: [0, 300, 310, 320, 330],
            systemdResults: [{ code: 0 }, { code: 0 }, { code: 0, stdout: "0\n" }, { code: 0 }],
        });
        const zeroPidResult = await runBenchmark(args, zeroPid.runtime);
        expect(zeroPidResult.report.runs[0].process_rss_max_bytes).toBeNull();
        expect(
            zeroPid.calls.some((call) => call[0] === "readFile" && call[1].startsWith("/proc/")),
        ).toBe(false);

        const noRss = fakeRuntime({
            nowValues: [0, 300, 310, 320, 330],
            statusText: "Name:\tservice\n",
            systemdResults: [{ code: 0 }, { code: 0 }, { code: 0, stdout: "321\n" }, { code: 0 }],
        });
        const second = await runBenchmark(args, noRss.runtime);
        expect(second.report.runs[0].process_rss_max_bytes).toBeNull();
        expect(noRss.calls.some((call) => call[1] === "/proc/321/status")).toBe(true);
    });

    it("reports a systemd cleanup failure after a successful start", async () => {
        const args = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
        ];
        const { runtime } = fakeRuntime({
            nowValues: [0, 300, 310, 320, 330, 340, 350],
            systemdResults: [
                { code: 0 },
                { code: 0 },
                { code: 0, stdout: "321\n" },
                { code: 1, stderr: "stop denied" },
            ],
        });
        const result = await runBenchmark(args, runtime);
        expect(result.report.runs[0].error).toContain(
            "Could not stop basishacks.service: stop denied",
        );
    });

    it("records systemd stop and start errors and checks cgroup limit failures", async () => {
        const args = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
            "--memory-limit-bytes",
            "500",
        ];
        const stopFailure = fakeRuntime({
            systemdResults: [{ code: 1, stderr: "already active" }],
        });
        const first = await runBenchmark(args, stopFailure.runtime);
        expect(first.exitCode).toBe(1);
        expect(first.report.runs[0].error).toContain("Could not stop");

        const startFailure = fakeRuntime({
            systemdResults: [{ code: 0 }, { code: 1, stderr: "service failed" }, { code: 0 }],
            cgroupValue: "900\n",
        });
        const second = await runBenchmark(args, startFailure.runtime);
        expect(second.exitCode).toBe(1);
        expect(second.report.runs[0].error).toContain("Could not start");
        expect(second.report.service_cgroup_memory_bytes.within_limit).toBe(false);
    });

    it("handles missing RSS data and malformed cgroup samples without crashing", async () => {
        const { runtime } = fakeRuntime({
            statusText: "Name:\tservice\n",
            cgroupValue: "not-a-number\n",
        });
        const args = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
        ];
        const { report, exitCode } = await runBenchmark(args, runtime);
        expect(exitCode).toBe(1);
        expect(report.runs[0].process_rss_max_bytes).toBeNull();
        expect(report.runs[0].error).toContain("Invalid cgroup memory value");
    });

    it("tolerates ENOENT gaps, records other sample errors, and supports empty response bodies", async () => {
        const missing = fakeRuntime({
            readError: Object.assign(new Error("missing sample"), { code: "ENOENT" }),
            responseBody: undefined,
        });
        const result = await runBenchmark([...base, "--runs", "1"], missing.runtime);
        expect(result.report.runs[0]).toMatchObject({ ready: true, process_rss_max_bytes: null });

        const failure = fakeRuntime({ readError: new Error("permission denied") });
        const args = [
            "--systemd-unit",
            "basishacks.service",
            "--url",
            "http://localhost",
            "--cgroup-memory-file",
            "/fixture/memory.current",
            "--runs",
            "1",
        ];
        const failed = await runBenchmark(args, failure.runtime);
        expect(failed.report.runs[0].error).toContain("permission denied");
    });
});
