#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function runStep(spawn, command, args, label, { cwd, shell }) {
    const result = spawn(command, args, {
        cwd,
        stdio: "inherit",
        shell,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

export function shouldRunPrebuild(argvEntry, moduleUrl) {
    return typeof argvEntry === "string" && resolve(argvEntry) === fileURLToPath(moduleUrl);
}

export function runPrebuildSteps({
    platform = process.platform,
    root = projectRoot,
    spawn = spawnSync,
    skipDocs = false,
} = {}) {
    if (!skipDocs) {
        runStep(
            spawn,
            "npm",
            ["run", "build", "--prefix", "documentation"],
            "VitePress documentation build",
            { cwd: root, shell: platform === "win32" },
        );
    }
    runStep(
        spawn,
        process.execPath,
        [resolve(root, "scripts/generate-icon-server-bundle.mjs")],
        "Server icon bundle generation",
        { cwd: root, shell: false },
    );
}

if (shouldRunPrebuild(process.argv[1], import.meta.url)) {
    // Dev starts reuse an existing docs build; production always rebuilds.
    const skipDocs =
        process.argv.includes("--dev") &&
        existsSync(resolve(projectRoot, "documentation/.vitepress/dist/index.html"));
    runPrebuildSteps({ skipDocs });
}
