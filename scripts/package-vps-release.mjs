#!/usr/bin/env bun
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { relocateServerImports } from "./relocate-server-imports.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(projectRoot, process.env.VPS_RELEASE_OUTPUT_DIR ?? "release-package");
const releaseRelativePath = relative(projectRoot, releaseRoot);

if (
    isAbsolute(releaseRelativePath) ||
    releaseRelativePath === ".." ||
    releaseRelativePath.startsWith(`..${sep}`)
) {
    throw new Error("The release package directory must remain inside the project workspace.");
}
if (existsSync(releaseRoot)) {
    throw new Error(
        `Refusing to overwrite ${releaseRoot}. Remove the previous generated release package first.`,
    );
}

const builtServer = resolve(projectRoot, ".output/server/index.mjs");
const migrationJournal = resolve(projectRoot, "drizzle/postgres/meta/_journal.json");
const includeProductionDependencies = process.env.VPS_RELEASE_INCLUDE_NODE_MODULES === "1";
if (!existsSync(builtServer)) {
    throw new Error("Build the Nuxt application before packaging the VPS release.");
}
if (!existsSync(migrationJournal)) {
    throw new Error("The PostgreSQL Drizzle migration journal is missing.");
}

await mkdir(releaseRoot, { recursive: true });
await cp(resolve(projectRoot, ".output"), resolve(releaseRoot, ".output"), { recursive: true });
await cp(resolve(projectRoot, "drizzle/postgres"), resolve(releaseRoot, "drizzle/postgres"), {
    recursive: true,
});
await cp(resolve(projectRoot, "start-fix.mjs"), resolve(releaseRoot, "start-fix.mjs"));
await mkdir(resolve(releaseRoot, "scripts"), { recursive: true });
await cp(resolve(projectRoot, "scripts/start.sh"), resolve(releaseRoot, "scripts/start.sh"));
await cp(resolve(projectRoot, ".env.example"), resolve(releaseRoot, ".env.example"));
await cp(resolve(projectRoot, "HACKATHON.yml"), resolve(releaseRoot, "HACKATHON.yml"));
await cp(resolve(projectRoot, "bun.lock"), resolve(releaseRoot, "bun.lock"));
for (const directory of ["patches", "vendor"]) {
    if (existsSync(resolve(projectRoot, directory))) {
        await cp(resolve(projectRoot, directory), resolve(releaseRoot, directory), {
            recursive: true,
        });
    }
}
const rewrittenImports = await relocateServerImports({
    serverDirectory: resolve(releaseRoot, ".output/server"),
    sourceRoot: projectRoot,
    packageRoot: releaseRoot,
});
await mkdir(resolve(releaseRoot, ".output/tools"), { recursive: true });

const buildOutput = await Bun.build({
    entrypoints: [
        resolve(projectRoot, "scripts/db-migrate.ts"),
        resolve(projectRoot, "scripts/export-hackathon.ts"),
        resolve(projectRoot, "scripts/import-sqlite-to-postgres.mjs"),
    ],
    outdir: resolve(releaseRoot, ".output/tools"),
    target: "node",
    packages: "external",
    naming: "[name].mjs",
    plugins: [
        {
            name: "nuxt-root-aliases",
            setup(build) {
                build.onResolve({ filter: /^(~~|@@)\// }, ({ path }) => ({
                    path: resolve(projectRoot, `${path.slice(3)}.ts`),
                }));
                build.onResolve({ filter: /^(~|@)\// }, ({ path }) => ({
                    path: resolve(projectRoot, "app", `${path.slice(2)}.ts`),
                }));
            },
        },
    ],
    tsconfig: resolve(projectRoot, ".nuxt/tsconfig.server.json"),
});

if (!buildOutput.success) {
    const messages = buildOutput.logs.map((entry) => entry.message).join("\n");
    throw new Error(`Could not bundle release database tools:\n${messages}`);
}

const sourceManifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
for (const dependency of ["better-sqlite3", "drizzle-orm", "postgres"]) {
    if (!sourceManifest.dependencies?.[dependency]) {
        throw new Error(`The release manifest must declare runtime dependency ${dependency}.`);
    }
}

const releaseManifest = {
    ...sourceManifest,
    private: true,
    type: "module",
    engines: { ...sourceManifest.engines, node: ">=24" },
    scripts: {
        start: "sh scripts/start.sh",
        "start:node": "node start-fix.mjs",
        "db:migrate": "bun .output/tools/db-migrate.mjs",
        "db:migrate:node": "node .output/tools/db-migrate.mjs",
        "db:export-hackathon": "bun .output/tools/export-hackathon.mjs",
        "db:import-sqlite": "bun .output/tools/import-sqlite-to-postgres.mjs",
        "db:import-sqlite:check": "bun .output/tools/import-sqlite-to-postgres.mjs --check-only",
        "db:import-sqlite:node": "node .output/tools/import-sqlite-to-postgres.mjs",
        "db:import-sqlite:check:node":
            "node .output/tools/import-sqlite-to-postgres.mjs --check-only",
    },
};

await writeFile(
    resolve(releaseRoot, "package.json"),
    `${JSON.stringify(releaseManifest, null, 4)}\n`,
    "utf8",
);

if (includeProductionDependencies) {
    const sourceNodeModules = resolve(projectRoot, "node_modules");
    if (!existsSync(sourceNodeModules)) {
        throw new Error("Production node_modules are missing; install them before packaging.");
    }
    await cp(sourceNodeModules, resolve(releaseRoot, "node_modules"), {
        recursive: true,
        dereference: true,
        filter: (sourcePath) =>
            !sourcePath.split(sep).some((segment) => segment === ".bin" || segment === ".cache"),
    });
}

for (const requiredPath of [
    ".output/server/index.mjs",
    ".output/tools/db-migrate.mjs",
    ".output/tools/export-hackathon.mjs",
    ".output/tools/import-sqlite-to-postgres.mjs",
    "drizzle/postgres/meta/_journal.json",
    "start-fix.mjs",
    "HACKATHON.yml",
    "scripts/start.sh",
    "package.json",
    ...(includeProductionDependencies
        ? [
              "node_modules/postgres/package.json",
              "node_modules/drizzle-orm/package.json",
              "node_modules/better-sqlite3/package.json",
          ]
        : []),
]) {
    if (!existsSync(resolve(releaseRoot, requiredPath))) {
        throw new Error(`Release package is missing required file: ${requiredPath}`);
    }
}

console.info(`Created self-contained VPS release files under ${releaseRoot}`);
console.info(`Made ${rewrittenImports} Nitro dependency import(s) relative to the release root.`);
if (!includeProductionDependencies) {
    console.info(
        "Package metadata is included; run bun install --production --frozen-lockfile before using this local package.",
    );
}
