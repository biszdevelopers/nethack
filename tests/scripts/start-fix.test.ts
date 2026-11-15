import { fileURLToPath } from "node:url";
import {
    createRuntime,
    importProductionServer,
    isDirectExecution,
    isLoopbackHttpOrigin,
    loopbackOriginPort,
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

    it("derives the listener port and loopback bind from a loopback HTTP origin", async () => {
        expect(loopbackOriginPort("http://localhost:24598")).toBe("24598");
        expect(loopbackOriginPort("http://127.0.0.1:3000")).toBe("3000");
        expect(loopbackOriginPort("http://[::1]:8080")).toBe("8080");
        expect(loopbackOriginPort("http://localhost")).toBeUndefined();
        expect(loopbackOriginPort("http://localhost:0")).toBeUndefined();
        expect(loopbackOriginPort("https://basishacks.example")).toBeUndefined();
        expect(loopbackOriginPort("http://basishacks.example:3000")).toBeUndefined();
        expect(loopbackOriginPort("not a URL")).toBeUndefined();
        expect(isLoopbackHttpOrigin("http://localhost:24598")).toBe(true);
        expect(isLoopbackHttpOrigin("https://localhost:24598")).toBe(false);
        expect(isLoopbackHttpOrigin("not a URL")).toBe(false);

        const environment = {
            CURRENT_URL_ORIGIN: "http://localhost:24598",
        } as NodeJS.ProcessEnv;
        const runtime = createRuntime({
            environment,
            globalObject: {},
            resolvePath: () => "/srv/app/.output/server/index.mjs",
            importServer: async () => undefined,
        });

        await startProduction(runtime);
        expect(environment.NITRO_PORT).toBe("24598");
        expect(environment.HOST).toBe("127.0.0.1");

        const explicit = {
            CURRENT_URL_ORIGIN: "http://localhost:24598",
            PORT: "3000",
            HOST: "0.0.0.0",
        } as NodeJS.ProcessEnv;
        await startProduction(
            createRuntime({
                environment: explicit,
                globalObject: {},
                resolvePath: () => "/srv/app/.output/server/index.mjs",
                importServer: async () => undefined,
            }),
        );
        expect(explicit.NITRO_PORT).toBeUndefined();
        expect(explicit.PORT).toBe("3000");
        expect(explicit.HOST).toBe("0.0.0.0");

        const nitroExplicit = {
            CURRENT_URL_ORIGIN: "http://localhost:24598",
            NITRO_PORT: "4000",
            NITRO_HOST: "127.0.0.1",
        } as NodeJS.ProcessEnv;
        await startProduction(
            createRuntime({
                environment: nitroExplicit,
                globalObject: {},
                resolvePath: () => "/srv/app/.output/server/index.mjs",
                importServer: async () => undefined,
            }),
        );
        expect(nitroExplicit.NITRO_PORT).toBe("4000");
        expect(nitroExplicit.PORT).toBeUndefined();
        expect(nitroExplicit.HOST).toBeUndefined();
    });

    it("uses the native module loader for the requested production module", async () => {
        const module = await importProductionServer("data:text/javascript,export default 42");
        expect(module.default).toBe(42);
    });
});
