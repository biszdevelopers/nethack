import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    findMissingRuntimeCoverage,
    findUnmeasuredSourceFiles,
    mergeCoverageFiles,
    mergeCoverageMaps,
    summarizeCoverageMap,
} from "../helpers/merge-vitest-coverage.mjs";

function coverageMap(statementCount: number, branchCounts: number[], functionCount: number) {
    return {
        "fixture.ts": {
            path: "fixture.ts",
            statementMap: {
                0: { start: { line: 1 }, end: { line: 1 } },
                1: { start: { line: 2 }, end: { line: 2 } },
            },
            fnMap: { 0: { name: "run", loc: { start: { line: 1 }, end: { line: 2 } } } },
            branchMap: {
                0: { type: "if", locations: [{ start: { line: 1 } }, { start: { line: 1 } }] },
            },
            s: { 0: statementCount, 1: statementCount },
            f: { 0: functionCount },
            b: { 0: branchCounts },
        },
    };
}

function executableCoverage(path: string) {
    return {
        path,
        statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
        fnMap: { 0: { name: "run", loc: { start: { line: 1 }, end: { line: 2 } } } },
        branchMap: {
            0: {
                type: "if",
                locations: [{ start: { line: 1 } }, { start: { line: 1 } }],
            },
        },
        s: { 0: 1 },
        f: { 0: 1 },
        b: { 0: [1, 1] },
    };
}

async function createCoverageFixture() {
    const root = await mkdtemp(join(process.cwd(), ".tmp-vitest", "coverage-gate-"));
    await Promise.all(
        ["app", "server", "shared", "scripts"].map((name) =>
            mkdir(join(root, name), { recursive: true }),
        ),
    );
    await writeFile(join(root, "app/action.ts"), "export const serverMode = import.meta.server;\n");
    await writeFile(join(root, "start-fix.mjs"), "export const production = true;\n");
    await writeFile(join(root, "drizzle.config.ts"), "export const dialect = 'postgresql';\n");
    return root;
}

describe("merged Vitest coverage enforcement", () => {
    it("combines counters for the same file and checks every coverage category", () => {
        const merged = mergeCoverageMaps(coverageMap(1, [1, 0], 1), coverageMap(0, [0, 1], 0));

        expect(merged["fixture.ts"]?.s).toEqual({ 0: 1, 1: 1 });
        expect(merged["fixture.ts"]?.b).toEqual({ 0: [1, 1] });
        expect(merged["fixture.ts"]?.f).toEqual({ 0: 1 });
        expect(summarizeCoverageMap(merged)).toEqual({
            statements: { covered: 2, total: 2 },
            branches: { covered: 2, total: 2 },
            functions: { covered: 1, total: 1 },
            lines: { covered: 2, total: 2 },
        });
    });

    it("does not mutate the input maps while merging", () => {
        const original = coverageMap(1, [1, 0], 1);
        const additional = coverageMap(0, [0, 1], 0);

        mergeCoverageMaps(original, additional);

        expect(original["fixture.ts"]?.s).toEqual({ 0: 1, 1: 1 });
        expect(additional["fixture.ts"]?.s).toEqual({ 0: 0, 1: 0 });
    });

    it("rejects source maps that cannot be safely combined", () => {
        const original = coverageMap(1, [1, 0], 1);
        const incompatible = coverageMap(1, [1], 1);

        expect(() => mergeCoverageMaps(original, incompatible)).toThrow(
            "Coverage branch shape differs for fixture.ts (0).",
        );
    });

    it("rejects matching counter IDs whose source locations differ", () => {
        const original = coverageMap(1, [1, 0], 1);
        const incompatible = coverageMap(1, [0, 1], 1);
        incompatible["fixture.ts"].statementMap[0].start.line = 9;

        expect(() => mergeCoverageMaps(original, incompatible)).toThrow(
            "Coverage source map differs for fixture.ts (statementMap).",
        );
    });

    it("normalizes only the known compile-time source-map column shifts", () => {
        const path = "app/composables/useBasisAuthSession.ts";
        const report = (column: number) => ({
            [path]: {
                path,
                statementMap: {
                    15: { start: { line: 22, column }, end: { line: 22, column: null } },
                },
                fnMap: {},
                branchMap: {
                    2: {
                        loc: { start: { line: 22, column }, end: { line: 22, column: null } },
                        type: "cond-expr",
                        locations: [
                            { start: { line: 22, column: 49 }, end: { line: 22, column: 69 } },
                            { start: { line: 22, column: 69 }, end: { line: 22, column: null } },
                        ],
                        line: 22,
                    },
                },
                s: { 15: 1 },
                f: {},
                b: { 2: [1, 0] },
            },
        });

        expect(mergeCoverageMaps(report(28), report(18))[path]?.s).toEqual({ 15: 2 });
    });

    it("normalizes the SSR API-user fetch branch column shift", () => {
        const path = "app/composables/useApiUser.ts";
        const report = (column: number) => ({
            [path]: {
                path,
                statementMap: {},
                fnMap: {},
                branchMap: {
                    2: {
                        loc: { start: { line: 34, column }, end: { line: 34, column: null } },
                        type: "cond-expr",
                        locations: [
                            { start: { line: 34, column: 37 }, end: { line: 34, column: 57 } },
                            { start: { line: 34, column: 57 }, end: { line: 34, column: null } },
                        ],
                        line: 34,
                    },
                },
                s: {},
                f: {},
                b: { 2: [1, 0] },
            },
        });

        expect(mergeCoverageMaps(report(16), report(8))[path]?.b).toEqual({ 2: [2, 0] });
    });

    it("reports files with no executable statement counters unless explicitly allowlisted", () => {
        const coverage: Record<
            string,
            { s: Record<string, number>; f: Record<string, number>; b: Record<string, number[]> }
        > = {
            "app/app.config.ts": { s: {}, f: {}, b: {} },
            "app/run.ts": { s: {}, f: {}, b: {} },
        };

        expect(findUnmeasuredSourceFiles(coverage)).toEqual(["app/run.ts"]);
    });

    it("requires every compile-time runtime conditional in both coverage reports", () => {
        const conditional = "app/composables/useBasisAuthSession.ts";
        const fixture = coverageMap(1, [1, 0], 1)["fixture.ts"];
        const client = { [conditional]: { ...fixture, path: conditional } };

        expect(findMissingRuntimeCoverage([client, {}], [conditional])).toEqual([conditional]);
        expect(findMissingRuntimeCoverage([client, client], [conditional])).toEqual([]);
    });

    it("merges reports only when root entrypoints and both runtime variants are present", async () => {
        const root = await createCoverageFixture();
        try {
            const conditionalPath = resolve(root, "app/action.ts");
            const launcherPath = resolve(root, "start-fix.mjs");
            const drizzlePath = resolve(root, "drizzle.config.ts");
            const clientReport = join(root, "client.json");
            const serverReport = join(root, "server.json");
            const output = join(root, "merged.json");
            const client = {
                [conditionalPath]: executableCoverage(conditionalPath),
                [launcherPath]: executableCoverage(launcherPath),
                [drizzlePath]: executableCoverage(drizzlePath),
                [resolve(root, "app/app.config.ts")]: {
                    path: resolve(root, "app/app.config.ts"),
                    statementMap: {},
                    fnMap: {},
                    branchMap: {},
                    s: {},
                    f: {},
                    b: {},
                },
            };
            await writeFile(clientReport, JSON.stringify(client));
            await writeFile(
                serverReport,
                JSON.stringify({ [conditionalPath]: executableCoverage(conditionalPath) }),
            );

            const summary = await mergeCoverageFiles([clientReport, serverReport], output, root);
            expect(summary.statements).toEqual({ covered: 3, total: 3 });
            expect(summary.branches).toEqual({ covered: 6, total: 6 });
            expect(summary.functions).toEqual({ covered: 3, total: 3 });
            expect(JSON.parse(await readFile(output, "utf8"))[conditionalPath]).toBeDefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("rejects a runtime conditional missing from the alternate report", async () => {
        const root = await createCoverageFixture();
        try {
            const conditionalPath = resolve(root, "app/action.ts");
            const launcherPath = resolve(root, "start-fix.mjs");
            const drizzlePath = resolve(root, "drizzle.config.ts");
            const clientReport = join(root, "client.json");
            const serverReport = join(root, "server.json");
            await writeFile(
                clientReport,
                JSON.stringify({
                    [conditionalPath]: executableCoverage(conditionalPath),
                    [launcherPath]: executableCoverage(launcherPath),
                    [drizzlePath]: executableCoverage(drizzlePath),
                }),
            );
            await writeFile(serverReport, JSON.stringify({}));

            await expect(
                mergeCoverageFiles([clientReport, serverReport], join(root, "merged.json"), root),
            ).rejects.toThrow("Coverage reports omit client/server runtime variants:");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
