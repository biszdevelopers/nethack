import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    parseRuntimeVersion,
    probeVersion,
    runIfDirect,
    runStartSelector,
    selectRuntime,
    spawnRuntime,
} from "../../scripts/start-runtime.mjs";

describe("startup runtime parsing", () => {
    it.each([
        ["1.3.14", { major: 1, minor: 3 }],
        ["v24.0.0", { major: 24, minor: 0 }],
        ["  2.1.0\n", { major: 2, minor: 1 }],
    ])("parses %j", (value, expected) => {
        expect(parseRuntimeVersion(value)).toEqual(expected);
    });

    it.each([undefined, "", "bun", "1", "v"])("rejects %j", (value) => {
        expect(parseRuntimeVersion(value)).toBeNull();
    });
});

describe("startup runtime selection", () => {
    it("prefers any Bun version at or above 1.3", () => {
        expect(selectRuntime({ bunVersion: "1.3.0", nodeVersion: "v24.0.0" })).toBe("bun");
        expect(selectRuntime({ bunVersion: "1.4.4" })).toBe("bun");
        expect(selectRuntime({ bunVersion: "2.0.0" })).toBe("bun");
    });

    it("falls back to Node 24 or newer", () => {
        expect(selectRuntime({ bunVersion: "1.2.9", nodeVersion: "v24.0.0" })).toBe("node");
        expect(selectRuntime({ nodeVersion: "v26.1.0" })).toBe("node");
    });

    it("rejects older runtimes", () => {
        expect(selectRuntime({})).toBeNull();
        expect(selectRuntime({ nodeVersion: "v22.0.0" })).toBeNull();
        expect(selectRuntime({ bunVersion: "0.8.0", nodeVersion: "v20.0.0" })).toBeNull();
    });
});

describe("startup selector wiring", () => {
    it("launches Bun when it is supported", async () => {
        const run = vi.fn(async () => 23);
        const exitCode = await runStartSelector({
            readVersion: (command) => (command === "bun" ? "1.3.14" : "v24.0.0"),
            run,
        });

        expect(exitCode).toBe(23);
        expect(run).toHaveBeenCalledWith("bun", ["start-fix.mjs"]);
    });

    it("launches Node when Bun is too old", async () => {
        const run = vi.fn(async () => 24);
        const exitCode = await runStartSelector({
            readVersion: (command) => (command === "bun" ? "1.2.9" : "v24.0.0"),
            run,
        });

        expect(exitCode).toBe(24);
        expect(run).toHaveBeenCalledWith("node", ["start-fix.mjs"]);
    });

    it("reports unsupported runtimes without launching anything", async () => {
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const run = vi.fn();

        const exitCode = await runStartSelector({
            readVersion: (command) => (command === "node" ? "v22.0.0" : undefined),
            run,
        });

        expect(exitCode).toBe(127);
        expect(stderr).toHaveBeenCalledWith(
            "Start requires Bun 1.3 or newer, or Node.js 24 or newer.\n",
        );
        expect(run).not.toHaveBeenCalled();
    });

    it("probes the real runtimes when no dependencies are injected", async () => {
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const originalPath = process.env.PATH;
        process.env.PATH = "";
        try {
            expect(await runStartSelector()).toBe(127);
            expect(stderr).toHaveBeenCalled();
        } finally {
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
    });

    it("reads a real runtime version and spawns a real command", async () => {
        expect(parseRuntimeVersion(probeVersion("node"))).not.toBeNull();
        expect(await spawnRuntime("node", ["--version"])).toBe(0);
    });

    it("reports a launch that cannot start as exit code 1", async () => {
        expect(await spawnRuntime("basishacks-missing-runtime-xyz", [])).toBe(1);
    });
});

describe("direct execution guard", () => {
    it("runs only when the module is the process entry point", async () => {
        const run = vi.fn(async () => 0);
        const dependencies = { readVersion: () => "1.3.14", run };
        const moduleUrl = pathToFileURL("/apps/scripts/start-runtime.mjs").href;
        const entryPath = "/apps/scripts/start-runtime.mjs";

        expect(await runIfDirect(moduleUrl, undefined, dependencies)).toBeNull();
        expect(await runIfDirect(moduleUrl, "/apps/scripts/other.mjs", dependencies)).toBeNull();
        expect(await runIfDirect(moduleUrl, entryPath, dependencies)).toBe(0);
        expect(run).toHaveBeenCalledWith("bun", ["start-fix.mjs"]);
    });

    it("sets the process exit code when the file is started directly", async () => {
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const originalPath = process.env.PATH;
        const originalEntry = process.argv[1];
        const originalExitCode = process.exitCode;
        process.env.PATH = "";
        process.argv[1] = resolve(process.cwd(), "scripts", "start-runtime.mjs");
        vi.resetModules();
        try {
            await import("../../scripts/start-runtime.mjs");
            expect(process.exitCode).toBe(127);
            expect(stderr).toHaveBeenCalledWith(
                "Start requires Bun 1.3 or newer, or Node.js 24 or newer.\n",
            );
        } finally {
            process.exitCode = originalExitCode;
            process.argv[1] = originalEntry;
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
    });
});
