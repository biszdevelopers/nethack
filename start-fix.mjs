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

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Keep local production on the same port as the configured loopback callback origin. */
export function loopbackOriginPort(origin) {
    try {
        const url = new URL(origin);
        return url.protocol === "http:" &&
            LOOPBACK_HOSTNAMES.has(url.hostname) &&
            /^\d+$/.test(url.port) &&
            Number(url.port) > 0
            ? url.port
            : undefined;
    } catch {
        return undefined;
    }
}

export function isLoopbackHttpOrigin(origin) {
    try {
        const url = new URL(origin);
        return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
    } catch {
        return false;
    }
}

export async function importProductionServer(specifier) {
    return await import(specifier);
}

export async function startProduction(runtime) {
    runtime.environment.NODE_ENV ??= "production";
    const environment = runtime.environment;
    const loopbackOrigin = isLoopbackHttpOrigin(environment.CURRENT_URL_ORIGIN);
    if (loopbackOrigin && !environment.NITRO_HOST && !environment.HOST) {
        environment.HOST = "127.0.0.1";
    }
    if (!environment.NITRO_PORT && !environment.PORT) {
        const originPort = loopbackOriginPort(environment.CURRENT_URL_ORIGIN);
        if (originPort) environment.NITRO_PORT = originPort;
    }
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
