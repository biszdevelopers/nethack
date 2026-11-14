import { fileURLToPath } from "node:url";
import {
    createRuntime,
    importProductionServer,
    isDirectExecution,
    runIfDirect,
    startProduction,
} from "../../start-fix.mjs";

describe("production startup launcher", () => {
    const moduleUrl = new URL("../../start-fix.mjs", import.meta.url).href;
    const executablePath = fileURLToPath(moduleUrl);

    it("creates default and overridden runtime adapters", () => {
        const defaults = createRuntime();
        expect(defaults.environment).toBe(process.env);
        expect(defaults.globalObject).toBe(globalThis);
        expect(defaults.resolvePath("fixture")).toContain("fixture");
        expect(defaults.importServer).toBe(importProductionServer);

        const overrides = {
            environment: { NODE_ENV: "test" },
            globalObject: {},
            resolvePath: () => "fixture-path",
            importServer: async () => "fixture-module",
        };
        expect(createRuntime(overrides)).toEqual(overrides);
    });

    it("identifies direct invocation and ignores absent or different entry paths", () => {
        expect(isDirectExecution(moduleUrl, undefined)).toBe(false);
        expect(isDirectExecution(moduleUrl, `${executablePath}.other`)).toBe(false);
        expect(isDirectExecution(moduleUrl, executablePath)).toBe(true);
    });

    it("sets production defaults, normalizes Windows bundle URLs, and imports the server entry", async () => {
        const state = { imported: [] as string[], globalObject: {} as Record<string, unknown> };
        const runtime = createRuntime({
            environment: {} as NodeJS.ProcessEnv,
            globalObject: state.globalObject,
            resolvePath: () => "C:\\apps\\basishacks\\.output\\server\\index.mjs",
            importServer: async (path: string) => {
                state.imported.push(path);
            },
        });

        await expect(startProduction(runtime)).resolves.toBe(
            "C:\\apps\\basishacks\\.output\\server\\index.mjs",
        );
        expect(runtime.environment.NODE_ENV).toBe("production");
        expect(state.globalObject._importMeta_).toEqual({
            url: "file:///C:/apps/basishacks/.output/server/index.mjs",
        });
        expect(state.imported).toEqual(["./.output/server/index.mjs"]);
    });

    it("preserves an explicitly configured environment and runs only for direct invocation", async () => {
        const imported: string[] = [];
        const runtime = createRuntime({
            environment: { NODE_ENV: "staging" } as NodeJS.ProcessEnv,
            globalObject: {},
            resolvePath: () => "/srv/app/.output/server/index.mjs",
            importServer: async (path: string) => {
                imported.push(path);
            },
        });

        await expect(runIfDirect(moduleUrl, undefined, runtime)).resolves.toBe(false);
        expect(imported).toEqual([]);
        await expect(runIfDirect(moduleUrl, executablePath, runtime)).resolves.toBe(true);
        expect(runtime.environment.NODE_ENV).toBe("staging");
        expect(imported).toEqual(["./.output/server/index.mjs"]);
    });

    it("uses the native module loader for the requested production module", async () => {
        const module = await importProductionServer("data:text/javascript,export default 42");
        expect(module.default).toBe(42);
    });
});
