import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../../scripts/postinstall.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("production-only postinstall", () => {
    it("skips source preparation when dev-only icon collections are absent", () => {
        const projectRoot = mkdtempSync(join(tmpdir(), "basishacks-postinstall-"));
        temporaryDirectories.push(projectRoot);
        mkdirSync(join(projectRoot, "scripts"));
        writeFileSync(
            join(projectRoot, "package.json"),
            JSON.stringify({ devDependencies: { "@iconify-json/lucide": "^1.0.0" } }),
        );
        copyFileSync(scriptPath, join(projectRoot, "scripts/postinstall.mjs"));

        const result = spawnSync(process.execPath, [join(projectRoot, "scripts/postinstall.mjs")], {
            encoding: "utf8",
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("Skipping source preparation");
        expect(result.stdout).toContain("@iconify-json/lucide");
    });
});
