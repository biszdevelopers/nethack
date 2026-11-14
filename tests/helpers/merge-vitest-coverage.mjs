import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { readdir } from "node:fs/promises";

const COUNTER_MAPS = ["s", "f", "b"];
const ZERO_COUNTER_ALLOWLIST = new Set([
    "app/app.config.ts",
    "app/components/admin/rubric-types.ts",
]);
const ROOT_SOURCE_FILES = ["start-fix.mjs", "drizzle.config.ts"];
const COLUMN_VARIANCE_ALLOWLIST = {
    "app/composables/usebasisauthsession.ts": {
        statementMap: new Set(["15"]),
        branchMap: new Set(["2"]),
    },
    "app/composables/useapiuser.ts": {
        branchMap: new Set(["2"]),
    },
};

function sortedKeys(value) {
    return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function mergeCounterMap(target, additional, file, property) {
    const targetKeys = sortedKeys(target[property]);
    const additionalKeys = sortedKeys(additional[property]);
    if (targetKeys.join("\0") !== additionalKeys.join("\0")) {
        throw new Error(`Coverage map shape differs for ${file} (${property}).`);
    }

    for (const key of targetKeys) {
        const left = target[property][key];
        const right = additional[property][key];
        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length) {
                throw new Error(`Coverage branch shape differs for ${file} (${key}).`);
            }
            target[property][key] = left.map((count, index) => count + right[index]);
        } else if (typeof left === "number" && typeof right === "number") {
            target[property][key] = left + right;
        } else {
            throw new Error(`Unsupported coverage counter shape for ${file} (${key}).`);
        }
    }
}

export function mergeCoverageMaps(...coverageMaps) {
    const merged = {};
    for (const coverage of coverageMaps) {
        for (const [file, item] of Object.entries(coverage)) {
            if (!merged[file]) {
                merged[file] = structuredClone(item);
                continue;
            }
            assertMetadataCompatible(merged[file], item, file);
            for (const property of COUNTER_MAPS) {
                mergeCounterMap(merged[file], item, file, property);
            }
        }
    }
    return merged;
}

function assertMetadataCompatible(target, additional, file) {
    for (const property of ["statementMap", "fnMap", "branchMap"]) {
        const left = comparableMetadata(property, target[property], file);
        const right = comparableMetadata(property, additional[property], file);
        if (left !== right) {
            throw new Error(`Coverage source map differs for ${file} (${property}).`);
        }
    }
}

function comparableMetadata(property, map = {}, file) {
    const normalizedFile = normalizeSourcePath(file).toLowerCase();
    const allowedIds = COLUMN_VARIANCE_ALLOWLIST[normalizedFile]?.[property] ?? new Set();
    const entries = Object.entries(map)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, metadata]) => {
            const normalized = structuredClone(metadata);
            if (allowedIds.has(id) && property === "statementMap") {
                normalized.start.column = null;
            } else if (allowedIds.has(id) && property === "branchMap") {
                normalized.loc.start.column = null;
            }
            return [id, normalized];
        });
    return JSON.stringify(entries);
}

function countCoverage(values) {
    const counts = Object.values(values).flatMap((value) =>
        Array.isArray(value) ? value : [value],
    );
    return {
        covered: counts.filter((count) => count > 0).length,
        total: counts.length,
    };
}

export function summarizeCoverageMap(coverage) {
    const totals = { statements: [], branches: [], functions: [], lines: [] };
    for (const item of Object.values(coverage)) {
        totals.statements.push(...Object.values(item.s));
        totals.functions.push(...Object.values(item.f));
        totals.branches.push(...Object.values(item.b).flat());

        const lineCounts = new Map();
        for (const [id, count] of Object.entries(item.s)) {
            const line = item.statementMap[id].start.line;
            lineCounts.set(line, Math.max(lineCounts.get(line) ?? 0, count));
        }
        totals.lines.push(...lineCounts.values());
    }

    return Object.fromEntries(
        Object.entries(totals).map(([name, values]) => [name, countCoverage(values)]),
    );
}

async function collectSourceFiles(root, directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectSourceFiles(root, path)));
        } else if (
            entry.isFile() &&
            [".js", ".mjs", ".ts"].includes(extname(entry.name)) &&
            !entry.name.endsWith(".d.ts")
        ) {
            files.push(relative(root, path));
        }
    }
    return files;
}

function normalizeSourcePath(path, root = process.cwd()) {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
    const value = relative(root, absolute).replaceAll("\\", "/");
    return process.platform === "win32" ? value.toLowerCase() : value;
}

export async function findMissingSourceFiles(coverage, root = process.cwd()) {
    const expectedFiles = (
        await Promise.all(
            ["app", "server", "shared", "scripts"].map((name) =>
                collectSourceFiles(root, resolve(root, name)),
            ),
        )
    ).flat();
    expectedFiles.push(...ROOT_SOURCE_FILES);
    const coveredFiles = new Set(
        Object.keys(coverage).map((path) => normalizeSourcePath(path, root)),
    );
    return expectedFiles
        .filter((path) => !coveredFiles.has(normalizeSourcePath(path, root)))
        .sort();
}

export function findUnmeasuredSourceFiles(coverage, root = process.cwd()) {
    return Object.entries(coverage)
        .filter(([path, item]) => {
            const normalized = normalizeSourcePath(path, root);
            if (ZERO_COUNTER_ALLOWLIST.has(normalized)) return false;
            return Object.keys(item.s ?? {}).length === 0;
        })
        .map(([path]) => normalizeSourcePath(path, root))
        .sort();
}

export function findMissingRuntimeCoverage(coverageMaps, conditionalFiles, root = process.cwd()) {
    return conditionalFiles.filter((file) =>
        coverageMaps.some((coverage) => {
            const coveredFiles = new Set(
                Object.keys(coverage).map((path) => normalizeSourcePath(path, root)),
            );
            return !coveredFiles.has(normalizeSourcePath(file, root));
        }),
    );
}

export async function findRuntimeConditionalFiles(root = process.cwd()) {
    const sourceFiles = (
        await Promise.all(
            ["app", "server", "shared", "scripts"].map((name) =>
                collectSourceFiles(root, resolve(root, name)),
            ),
        )
    ).flat();
    const conditionalFiles = await Promise.all(
        sourceFiles.map(async (path) => ({
            path,
            source: await readFile(resolve(root, path), "utf8"),
        })),
    );
    return conditionalFiles
        .filter(({ source }) => /\bimport\.meta\.(?:server|client)\b/.test(source))
        .map(({ path }) => path)
        .sort();
}

export async function mergeCoverageFiles(inputs, output, root = process.cwd()) {
    if (inputs.length < 2) throw new Error("At least two coverage reports are required.");
    const maps = await Promise.all(
        inputs.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))),
    );
    const merged = mergeCoverageMaps(...maps);
    const missing = await findMissingSourceFiles(merged, root);
    if (missing.length) {
        throw new Error(`Coverage reports omit source files:\n${missing.join("\n")}`);
    }
    const unmeasured = findUnmeasuredSourceFiles(merged, root);
    if (unmeasured.length) {
        throw new Error(
            `Coverage reports contain unmeasured executable files:\n${unmeasured.join("\n")}`,
        );
    }
    const runtimeConditionalFiles = await findRuntimeConditionalFiles(root);
    const missingRuntimeCoverage = findMissingRuntimeCoverage(maps, runtimeConditionalFiles, root);
    if (missingRuntimeCoverage.length) {
        throw new Error(
            `Coverage reports omit client/server runtime variants:\n${missingRuntimeCoverage.join("\n")}`,
        );
    }

    const summary = summarizeCoverageMap(merged);
    const report = Object.entries(summary)
        .map(([name, counts]) => `${name}: ${counts.covered}/${counts.total}`)
        .join("\n");
    const incomplete = Object.entries(summary).filter(
        ([, counts]) => counts.covered !== counts.total,
    );
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(merged)}\n`, "utf8");
    console.info(`Merged coverage written to ${outputPath}\n${report}`);
    if (incomplete.length) {
        throw new Error(`Coverage must reach 100% in every category:\n${report}`);
    }
    return summary;
}

async function main() {
    const [, , ...args] = process.argv;
    if (args.length < 2) {
        throw new Error(
            "Usage: node tests/helpers/merge-vitest-coverage.mjs <client-report.json> <server-report.json> [output.json]",
        );
    }
    const [clientReport, serverReport, output = ".tmp-vitest/coverage-final.json"] = args;
    await mergeCoverageFiles([clientReport, serverReport], output);
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
