import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runPrebuildSteps, shouldRunPrebuild } from "../../scripts/prebuild.mjs";

describe("prebuild launcher", () => {
    it("recognizes direct execution without running when imported by Vitest", () => {
        const scriptPath = resolve(import.meta.dirname, "../../scripts/prebuild.mjs");
        const moduleUrl = pathToFileURL(scriptPath).href;

        expect(shouldRunPrebuild(scriptPath, moduleUrl)).toBe(true);
        expect(shouldRunPrebuild(undefined, moduleUrl)).toBe(false);
        expect(shouldRunPrebuild(`${scriptPath}.test`, moduleUrl)).toBe(false);
    });

    it("uses the Windows shell only for npm and launches Node directly", () => {
        const spawn = vi.fn(() => ({ status: 0, error: undefined }));

        runPrebuildSteps({ platform: "win32", root: "C:/workspace", spawn });

        expect(spawn).toHaveBeenNthCalledWith(
            1,
            "npm",
            ["run", "build", "--prefix", "documentation"],
            expect.objectContaining({ cwd: "C:/workspace", shell: true }),
        );
        expect(spawn).toHaveBeenNthCalledWith(
            2,
            process.execPath,
            [resolve("C:/workspace", "scripts/generate-icon-server-bundle.mjs")],
            expect.objectContaining({ cwd: "C:/workspace", shell: false }),
        );
    });

    it("runs npm without a shell on non-Windows systems and uses default options", () => {
        const spawn = vi.fn(() => ({ status: 0, error: undefined }));

        runPrebuildSteps({ platform: "linux", spawn });

        expect(spawn).toHaveBeenNthCalledWith(
            1,
            "npm",
            expect.any(Array),
            expect.objectContaining({ cwd: expect.any(String), shell: false }),
        );
    });

    it("propagates spawn errors and nonzero command exits", () => {
        const spawnError = new Error("Node could not start");
        const spawnFailure = vi.fn(() => ({ status: null, error: spawnError }));
        expect(() => runPrebuildSteps({ platform: "linux", spawn: spawnFailure })).toThrow(
            spawnError,
        );

        const commandFailure = vi.fn(() => ({ status: 1, error: undefined }));
        expect(() => runPrebuildSteps({ platform: "linux", spawn: commandFailure })).toThrow(
            "VitePress documentation build failed with exit code 1.",
        );
    });
});
