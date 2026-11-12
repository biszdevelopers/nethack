import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../../scripts/benchmark-vps.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("VPS benchmark argument validation", () => {
    it("rejects cross-origin targets before sending configured headers", () => {
        const targetFile = writeTargets([{ path: "https://example.org/collect" }]);
        const result = runBenchmark([
            "--mode",
            "idle",
            "--url",
            "https://basishacks.example",
            "--pid",
            "1",
            "--targets",
            targetFile,
            "--warmup",
            "1",
            "--duration",
            "1",
        ]);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("must use the same origin as --url");
    });

    it("requires cgroup and database measurements for a load run", () => {
        const result = runBenchmark([
            "--mode",
            "load",
            "--url",
            "http://127.0.0.1:3000",
            "--pid",
            "1",
            "--targets",
            "unused-target-file.json",
        ]);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("--cgroup-memory-file is required for load runs");
    });
});

function writeTargets(targets: unknown[]) {
    const directory = mkdtempSync(join(tmpdir(), "basishacks-benchmark-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "targets.json");
    writeFileSync(path, JSON.stringify(targets));
    return path;
}

function runBenchmark(args: string[]) {
    return spawnSync(process.execPath, [scriptPath, ...args], {
        encoding: "utf8",
        env: { ...process.env, BENCHMARK_HEADERS_JSON: '{"Authorization":"Bearer test"}' },
    });
}
