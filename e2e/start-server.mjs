import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startOidcTestProvider } from "./oidc-provider.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DATABASE_NAME = "basishacks_e2e";
const BLOCKED_DATABASE_OPTIONS = new Set([
    "database",
    "dbname",
    "host",
    "hostaddr",
    "options",
    "port",
    "service",
    "servicefile",
]);

function parseDatabaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
    }

    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
        throw new Error(
            "The E2E database host must be the numeric loopback address 127.0.0.1 or ::1.",
        );
    }
    if (url.port === "0") throw new Error("DATABASE_URL must use a valid nonzero port.");
    if (url.hash) throw new Error("DATABASE_URL must not contain a fragment.");

    let databaseName;
    try {
        databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
        throw new Error("DATABASE_URL must contain a valid database name.");
    }
    if (url.pathname.split("/").length !== 2 || databaseName !== E2E_DATABASE_NAME) {
        throw new Error(`The E2E database name must be exactly ${E2E_DATABASE_NAME}.`);
    }

    for (const key of url.searchParams.keys()) {
        if (BLOCKED_DATABASE_OPTIONS.has(key.toLowerCase())) {
            throw new Error(
                `DATABASE_URL may not override the isolated database's ${key} setting.`,
            );
        }
    }
    return url;
}

/** Validate isolation settings without starting a provider or app process. */
export function validateE2eConfiguration(env = process.env) {
    if (env.BASISHACKS_E2E !== "1") {
        throw new Error("The browser harness requires the explicit BASISHACKS_E2E=1 opt-in.");
    }
    if (env.NODE_ENV === "production") {
        throw new Error("The browser harness cannot run with NODE_ENV=production.");
    }
    if (typeof env.DATABASE_URL !== "string" || env.DATABASE_URL.length === 0) {
        throw new Error("DATABASE_URL must point to the isolated E2E database.");
    }

    const databaseUrl = parseDatabaseUrl(env.DATABASE_URL);
    const appOrigin = env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3005";
    let appUrl;
    try {
        appUrl = new URL(appOrigin);
    } catch {
        throw new Error("PLAYWRIGHT_BASE_URL must be a valid loopback HTTP origin with a port.");
    }
    if (
        appUrl.protocol !== "http:" ||
        appUrl.hostname !== "127.0.0.1" ||
        !appUrl.port ||
        Number(appUrl.port) < 1 ||
        Number(appUrl.port) > 65_535 ||
        appUrl.username ||
        appUrl.password ||
        appUrl.pathname !== "/" ||
        appUrl.search ||
        appUrl.hash
    ) {
        throw new Error(
            "PLAYWRIGHT_BASE_URL must be a credential-free HTTP origin on 127.0.0.1 with an explicit port.",
        );
    }

    return Object.freeze({
        appOrigin: appUrl.origin,
        port: appUrl.port,
        databaseUrl: databaseUrl.href,
        projectRoot: PROJECT_ROOT,
        serverEntry: resolve(PROJECT_ROOT, ".output", "server", "index.mjs"),
    });
}

function delay(milliseconds) {
    let timer;
    const promise = new Promise((resolvePromise) => {
        timer = setTimeout(resolvePromise, milliseconds);
    });
    return { promise, cancel: () => clearTimeout(timer) };
}

export async function runE2eServer(env = process.env) {
    const config = validateE2eConfiguration(env);
    await access(config.serverEntry);

    const clientId = `basishacks-e2e-${randomBytes(12).toString("base64url")}`;
    const clientSecret = randomBytes(32).toString("base64url");
    const cookieSecret = randomBytes(48).toString("base64url");
    const resource = "devconnect://nethack.bisz.dev";
    let provider;
    let child;
    let childExitResult;
    let childExit;
    let resolveChildExit;
    let shutdownPromise;
    let signalExitCode;

    const shutdown = (exitCode = 1) => {
        if (shutdownPromise) return shutdownPromise;
        shutdownPromise = (async () => {
            if (child && !childExitResult) {
                child.kill("SIGTERM");
                const gracefulWait = delay(5000);
                const result = await Promise.race([childExit, gracefulWait.promise]);
                gracefulWait.cancel();
                if (!result && !childExitResult) {
                    child.kill("SIGKILL");
                    const forcedWait = delay(2000);
                    await Promise.race([childExit, forcedWait.promise]);
                    forcedWait.cancel();
                }
            }
            if (provider) await provider.close();
            process.exitCode = exitCode;
        })();
        return shutdownPromise;
    };

    const onInterrupt = () => {
        signalExitCode = 130;
        void shutdown(130).catch((error) => console.error("E2E shutdown failed:", error));
    };
    const onTerminate = () => {
        signalExitCode = 143;
        void shutdown(143).catch((error) => console.error("E2E shutdown failed:", error));
    };

    try {
        provider = await startOidcTestProvider({
            appOrigin: config.appOrigin,
            clientId,
            clientSecret,
            resource,
            users: [
                {
                    sub: "e2e-participant",
                    email: "participant@e2e.basishacks.invalid",
                    name: "Participant Fixture",
                    permissions: ["participant"],
                },
                {
                    sub: "e2e-judge",
                    email: "judge@e2e.basishacks.invalid",
                    name: "Judge Fixture",
                    permissions: ["judge"],
                },
                {
                    sub: "e2e-admin",
                    email: "admin@e2e.basishacks.invalid",
                    name: "Admin Fixture",
                    permissions: ["admin"],
                },
            ],
        });

        child = spawn(process.execPath, [config.serverEntry], {
            cwd: config.projectRoot,
            env: {
                ...env,
                NODE_ENV: "test",
                PORT: config.port,
                HOST: "127.0.0.1",
                CURRENT_URL_ORIGIN: config.appOrigin,
                BASIS_AUTH_ISSUER: provider.issuer,
                BASIS_AUTH_CLIENT_ID: clientId,
                BASIS_AUTH_CLIENT_SECRET: clientSecret,
                BASIS_AUTH_RESOURCE: resource,
                BASIS_AUTH_COOKIE_SECRET: cookieSecret,
                TRUSTED_PROXY_HOPS: "0",
                DISABLE_DEBUG_ROUTES: "1",
                DATABASE_URL: config.databaseUrl,
            },
            stdio: "inherit",
        });
        childExit = new Promise((resolvePromise) => {
            resolveChildExit = resolvePromise;
        });
        child.once("exit", (code, signal) => {
            childExitResult = { code, signal };
            resolveChildExit(childExitResult);
            void shutdown(code ?? 1).catch((error) => console.error("E2E shutdown failed:", error));
        });
        child.once("error", (error) => {
            childExitResult = { error };
            resolveChildExit(childExitResult);
            void shutdown(1).catch((shutdownError) =>
                console.error("E2E shutdown failed:", shutdownError),
            );
        });
        process.once("SIGINT", onInterrupt);
        process.once("SIGTERM", onTerminate);

        const readyUrl = new URL("/api/seasons", config.appOrigin);
        const timeoutAt = Date.now() + 120_000;
        let ready = false;
        while (Date.now() < timeoutAt) {
            if (signalExitCode !== undefined) return;
            if (childExitResult) {
                if (childExitResult.error) throw childExitResult.error;
                throw new Error("The E2E app exited before it became ready.");
            }
            try {
                const response = await fetch(readyUrl, { signal: AbortSignal.timeout(3000) });
                try {
                    if (response.ok) {
                        ready = true;
                        break;
                    }
                } finally {
                    await response.body?.cancel().catch(() => {});
                }
            } catch {
                // The app may still be applying migrations or starting its listener.
            }
            if (signalExitCode !== undefined) return;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
        }

        if (!ready) throw new Error("The E2E app did not become ready within 120 seconds.");
        const result = await childExit;
        if (result.error) throw result.error;
    } finally {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
        await shutdown(childExitResult?.code ?? 1);
    }
}

const isMain =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
    runE2eServer().catch((error) => {
        console.error(error);
        if (process.exitCode === undefined) process.exitCode = 1;
    });
}
