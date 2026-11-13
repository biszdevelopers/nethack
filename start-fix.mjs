#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function createRuntime(overrides = {}) {
    return {
        environment: overrides.environment ?? process.env,
        globalObject: overrides.globalObject ?? globalThis,
        resolvePath: overrides.resolvePath ?? resolve,
        importServer: overrides.importServer ?? importProductionServer,
    };
}

export async function importProductionServer(specifier) {
    return await import(specifier);
}

export async function startProduction(runtime) {
    runtime.environment.NODE_ENV ??= "production";
    const entryPath = runtime.resolvePath(".output/server/index.mjs");
    runtime.globalObject._importMeta_ = { url: `file:///${entryPath.replaceAll("\\", "/")}` };
    await runtime.importServer("./.output/server/index.mjs");
    return entryPath;
}

export function isDirectExecution(moduleUrl, argvPath) {
    return Boolean(argvPath) && moduleUrl === pathToFileURL(resolve(argvPath)).href;
}

export async function runIfDirect(moduleUrl, argvPath, runtime = createRuntime()) {
    if (!isDirectExecution(moduleUrl, argvPath)) return false;
    await startProduction(runtime);
    return true;
}

await runIfDirect(import.meta.url, process.argv[1]);
