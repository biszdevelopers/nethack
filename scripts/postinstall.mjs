#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const iconCollections = Object.keys(manifest.devDependencies ?? {}).filter((name) =>
    name.startsWith("@iconify-json/"),
);
const missingCollections = iconCollections.filter(
    (name) => !existsSync(resolve(projectRoot, "node_modules", name, "package.json")),
);

if (missingCollections.length > 0) {
    console.info(
        `Skipping source preparation because icon build dependencies are not installed: ${missingCollections.join(", ")}. Production releases use the prebuilt Nuxt output.`,
    );
} else {
    for (const args of [
        ["scripts/generate-icon-server-bundle.mjs"],
        ["node_modules/nuxt/bin/nuxt.mjs", "prepare"],
    ]) {
        const result = spawnSync(process.execPath, args, {
            cwd: projectRoot,
            stdio: "inherit",
        });

        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
