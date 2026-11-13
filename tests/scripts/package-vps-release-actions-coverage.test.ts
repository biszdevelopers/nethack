import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, sep } from "node:path";

const state = vi.hoisted(() => ({
    build: vi.fn(async () => ({ success: true, logs: [] as Array<{ message: string }> })),
    relocate: vi.fn(async () => 4),
    cp: vi.fn(async (..._args: any[]) => undefined),
    mkdir: vi.fn(async (..._args: any[]) => undefined),
    readFile: vi.fn(async () =>
        JSON.stringify({
            dependencies: { "better-sqlite3": "1", "drizzle-orm": "1", postgres: "1" },
            engines: { node: ">=24" },
            scripts: { test: "vitest" },
        }),
    ),
    writeFile: vi.fn(async (..._args: any[]) => undefined),
    releaseExists: false,
    builtServerExists: true,
    journalExists: true,
    optionalDirectoriesExist: true,
    sourceNodeModulesExist: true,
    missingReleasePath: undefined as string | undefined,
    buildResult: undefined as undefined | { success: boolean; logs: Array<{ message: string }> },
    manifest: undefined as undefined | Record<string, any>,
}));

vi.mock("node:fs/promises", () => ({
    cp: state.cp,
    mkdir: state.mkdir,
    readFile: state.readFile,
    writeFile: state.writeFile,
}));
vi.mock("node:fs", () => ({
    existsSync: (path: string) => {
        const normalized = path.replaceAll("\\", "/");
        const outputDirectory = process.env.VPS_RELEASE_OUTPUT_DIR ?? "release-package";
        if (normalized.endsWith(`/${outputDirectory}`)) return state.releaseExists;
        if (normalized.endsWith("/.output/server/index.mjs")) return state.builtServerExists;
        if (normalized.endsWith("/drizzle/postgres/meta/_journal.json")) return state.journalExists;
        if (normalized.endsWith("/patches") || normalized.endsWith("/vendor"))
            return state.optionalDirectoriesExist;
        if (normalized.endsWith("node_modules")) return state.sourceNodeModulesExist;
        if (normalized.includes("/release-package")) {
            return (
                !state.missingReleasePath || !normalized.endsWith(`/${state.missingReleasePath}`)
            );
        }
        return false;
    },
}));
vi.mock("../../scripts/relocate-server-imports.mjs", () => ({
    relocateServerImports: state.relocate,
}));

const projectRoot = resolve(import.meta.dirname, "../..");
const originalReleaseOutput = process.env.VPS_RELEASE_OUTPUT_DIR;
const originalIncludeDependencies = process.env.VPS_RELEASE_INCLUDE_NODE_MODULES;

describe("VPS release package builder", () => {
    beforeEach(() => {
        vi.resetModules();
        state.build.mockReset().mockResolvedValue({ success: true, logs: [] });
        state.relocate.mockReset().mockResolvedValue(4);
        state.cp.mockReset().mockResolvedValue(undefined);
        state.mkdir.mockReset().mockResolvedValue(undefined);
        state.readFile.mockReset().mockImplementation(async () =>
            JSON.stringify(
                state.manifest ?? {
                    dependencies: { "better-sqlite3": "1", "drizzle-orm": "1", postgres: "1" },
                    engines: { node: ">=24" },
                    scripts: { test: "vitest" },
                },
            ),
        );
        state.writeFile.mockReset().mockResolvedValue(undefined);
        state.releaseExists = false;
        state.builtServerExists = true;
        state.journalExists = true;
        state.optionalDirectoriesExist = true;
        state.sourceNodeModulesExist = true;
        state.missingReleasePath = undefined;
        state.manifest = undefined;
        vi.stubGlobal("Bun", { build: state.build });
        process.env.VPS_RELEASE_OUTPUT_DIR = "release-package";
        delete process.env.VPS_RELEASE_INCLUDE_NODE_MODULES;
        vi.stubGlobal("console", { ...console, info: vi.fn(), error: vi.fn(), warn: vi.fn() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalReleaseOutput === undefined) delete process.env.VPS_RELEASE_OUTPUT_DIR;
        else process.env.VPS_RELEASE_OUTPUT_DIR = originalReleaseOutput;
        if (originalIncludeDependencies === undefined)
            delete process.env.VPS_RELEASE_INCLUDE_NODE_MODULES;
        else process.env.VPS_RELEASE_INCLUDE_NODE_MODULES = originalIncludeDependencies;
    });

    async function run(outputDirectory = "release-package") {
        process.env.VPS_RELEASE_OUTPUT_DIR = outputDirectory;
        vi.resetModules();
        await import("../../scripts/package-vps-release.mjs");
    }

    it("rejects output paths that escape the workspace", async () => {
        await expect(run("../outside-release")).rejects.toThrow("must remain inside");
        expect(state.mkdir).not.toHaveBeenCalled();
    });

    it("refuses to replace an existing release package", async () => {
        state.releaseExists = true;
        await expect(run()).rejects.toThrow("Refusing to overwrite");
        expect(state.mkdir).not.toHaveBeenCalled();
    });

    it("requires a production server build and migration journal", async () => {
        state.builtServerExists = false;
        await expect(run()).rejects.toThrow("Build the Nuxt application");

        state.builtServerExists = true;
        state.journalExists = false;
        await expect(run()).rejects.toThrow("migration journal is missing");
    });

    it("copies the production release, rewrites Nitro imports, and emits runtime commands", async () => {
        state.optionalDirectoriesExist = false;
        await run();

        expect(state.cp).toHaveBeenCalledTimes(5);
        expect(state.relocate).toHaveBeenCalledWith({
            serverDirectory: resolve(projectRoot, "release-package/.output/server"),
            sourceRoot: projectRoot,
            packageRoot: resolve(projectRoot, "release-package"),
        });
        expect(state.build).toHaveBeenCalledWith(
            expect.objectContaining({
                target: "node",
                packages: "external",
                naming: "[name].mjs",
            }),
        );
        const packageWrite = state.writeFile.mock.calls.find(([path]) =>
            String(path).endsWith("package.json"),
        );
        const manifest = JSON.parse(packageWrite?.[1] as string);
        expect(manifest).toMatchObject({
            private: true,
            type: "module",
            engines: { node: ">=24" },
            scripts: { start: "bun start-fix.mjs", "start:node": "node start-fix.mjs" },
        });
        expect(manifest.scripts["db:import-sqlite:check:node"]).toContain("--check-only");
    });

    it("resolves Nuxt server and app aliases through the database-tool bundler plugin", async () => {
        await run();
        const options = state.build.mock.calls[0]?.[0];
        const resolvers: Array<(args: { path: string }) => { path: string }> = [];
        options.plugins[0].setup({
            onResolve: (
                _options: unknown,
                resolver: (args: { path: string }) => { path: string },
            ) => {
                resolvers.push(resolver);
            },
        });

        expect(resolvers).toHaveLength(2);
        expect(resolvers[0]?.({ path: "~~/server/utils/database" })).toEqual({
            path: resolve(projectRoot, "server/utils/database.ts"),
        });
        expect(resolvers[1]?.({ path: "~/utils/errors" })).toEqual({
            path: resolve(projectRoot, "app/utils/errors.ts"),
        });
    });

    it("copies optional patch and vendor directories when present", async () => {
        await run();
        expect(state.cp.mock.calls.map(([source]) => String(source))).toEqual(
            expect.arrayContaining([
                resolve(projectRoot, "patches"),
                resolve(projectRoot, "vendor"),
            ]),
        );
    });

    it("reports the bundler diagnostics when database-tool bundling fails", async () => {
        state.build.mockResolvedValue({ success: false, logs: [{ message: "syntax issue" }] });
        await expect(run()).rejects.toThrow(
            "Could not bundle release database tools:\nsyntax issue",
        );
    });

    it.each(["better-sqlite3", "drizzle-orm", "postgres"])(
        "requires %s as a runtime dependency",
        async (dependency) => {
            state.manifest = {
                dependencies: Object.fromEntries(
                    ["better-sqlite3", "drizzle-orm", "postgres"]
                        .filter((item) => item !== dependency)
                        .map((item) => [item, "1"]),
                ),
            };
            await expect(run()).rejects.toThrow(`must declare runtime dependency ${dependency}`);
        },
    );

    it("rejects packaging dependencies when node_modules is absent", async () => {
        process.env.VPS_RELEASE_INCLUDE_NODE_MODULES = "1";
        state.sourceNodeModulesExist = false;
        await expect(run()).rejects.toThrow("Production node_modules are missing");
    });

    it("filters development binaries and caches while packaging dependencies", async () => {
        process.env.VPS_RELEASE_INCLUDE_NODE_MODULES = "1";
        state.cp.mockImplementation(async (source, _destination, options) => {
            if (options?.filter) {
                const nativePath = (parts: string[]) => [source, ...parts].join(sep);
                expect(options.filter(nativePath([".bin", "tool"]))).toBe(false);
                expect(options.filter(nativePath([".cache", "data"]))).toBe(false);
                expect(options.filter(nativePath(["postgres", "package.json"]))).toBe(true);
            }
        });
        await run();
        const dependencyCopy = state.cp.mock.calls.find(([source]) =>
            String(source).endsWith("node_modules"),
        );
        expect(dependencyCopy?.[2]).toMatchObject({ recursive: true, dereference: true });
    });

    it("fails if any required release file is absent", async () => {
        state.missingReleasePath = ".output/tools/db-migrate.mjs";
        await expect(run()).rejects.toThrow(
            "Release package is missing required file: .output/tools/db-migrate.mjs",
        );
    });

    it("checks packaged dependencies when requested and handles an output override", async () => {
        process.env.VPS_RELEASE_INCLUDE_NODE_MODULES = "1";
        process.env.VPS_RELEASE_OUTPUT_DIR = "release-package-custom";
        await run("release-package-custom");
        expect(state.writeFile).toHaveBeenCalledWith(
            resolve(projectRoot, "release-package-custom/package.json"),
            expect.any(String),
            "utf8",
        );
    });

    it("uses the default release output directory when no override is configured", async () => {
        delete process.env.VPS_RELEASE_OUTPUT_DIR;
        vi.resetModules();
        await import("../../scripts/package-vps-release.mjs");

        expect(state.mkdir).toHaveBeenCalledWith(resolve(projectRoot, "release-package"), {
            recursive: true,
        });
    });
});
