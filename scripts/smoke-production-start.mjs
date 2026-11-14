#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const runtime = process.argv[2];
if (!new Set(["bun", "node"]).has(runtime)) {
    throw new Error("Usage: node scripts/smoke-production-start.mjs <bun|node>");
}

const port = await getAvailablePort();
const command = runtime === "bun" ? "bun" : process.execPath;
const args = runtime === "bun" ? ["run", "start"] : ["start-fix.mjs"];
const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let spawnError;
const appendOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
};
child.stdout.setEncoding("utf8").on("data", appendOutput);
child.stderr.setEncoding("utf8").on("data", appendOutput);
child.once("error", (error) => {
    spawnError = error;
});

try {
    await waitForDatabaseBackedResponse(
        child,
        port,
        () => output,
        () => spawnError,
    );
    console.info(`${runtime} production startup smoke test passed.`);
} catch (error) {
    throw new Error(`${error.message}\n\n${output}`, { cause: error });
} finally {
    await stopProcess(child);
}

async function getAvailablePort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Could not allocate a local port for the startup smoke test.");
    }
    await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    return address.port;
}

async function waitForDatabaseBackedResponse(
    processHandle,
    selectedPort,
    getOutput,
    getSpawnError,
) {
    const deadline = Date.now() + 60_000;
    let lastError = "No response received.";

    while (Date.now() < deadline) {
        const error = getSpawnError();
        if (error) {
            throw new Error(`Could not start the ${runtime} server: ${error.message}`);
        }
        if (processHandle.signalCode !== null) {
            throw new Error(
                `The ${runtime} server was terminated by signal ${processHandle.signalCode}.`,
            );
        }
        if (processHandle.exitCode !== null) {
            throw new Error(`The ${runtime} server exited with code ${processHandle.exitCode}.`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${selectedPort}/api/seasons/active`, {
                signal: AbortSignal.timeout(2_000),
            });
            const body = await response.text();
            if (response.status === 200) return;
            lastError = `The database-backed endpoint returned HTTP ${response.status}: ${body.slice(0, 500)}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`The ${runtime} server did not become ready: ${lastError}\n${getOutput()}`);
}

async function stopProcess(processHandle) {
    if (
        processHandle.pid === undefined ||
        processHandle.exitCode !== null ||
        processHandle.signalCode !== null
    ) {
        return;
    }

    try {
        if (processHandle.pid && process.platform !== "win32") {
            process.kill(-processHandle.pid, "SIGTERM");
        } else {
            processHandle.kill("SIGTERM");
        }
    } catch {
        processHandle.kill("SIGTERM");
    }

    await Promise.race([
        new Promise((resolve) => processHandle.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);

    if (processHandle.exitCode === null && processHandle.signalCode === null) {
        try {
            if (processHandle.pid && process.platform !== "win32") {
                process.kill(-processHandle.pid, "SIGKILL");
            } else {
                processHandle.kill("SIGKILL");
            }
        } catch {
            processHandle.kill("SIGKILL");
        }
    }
}
