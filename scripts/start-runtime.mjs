import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MINIMUM_BUN_MAJOR = 1;
const MINIMUM_BUN_MINOR = 3;
const MINIMUM_NODE_MAJOR = 24;
const LAUNCHER = "start-fix.mjs";
const UNSUPPORTED_MESSAGE = "Start requires Bun 1.3 or newer, or Node.js 24 or newer.";

export function parseRuntimeVersion(output) {
    const match = /^v?(\d+)\.(\d+)/.exec(String(output ?? "").trim());
    return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

export function selectRuntime({ bunVersion, nodeVersion } = {}) {
    const bun = parseRuntimeVersion(bunVersion);
    if (
        bun &&
        (bun.major > MINIMUM_BUN_MAJOR ||
            (bun.major === MINIMUM_BUN_MAJOR && bun.minor >= MINIMUM_BUN_MINOR))
    ) {
        return "bun";
    }

    const node = parseRuntimeVersion(nodeVersion);
    if (node && node.major >= MINIMUM_NODE_MAJOR) return "node";

    return null;
}

export function probeVersion(command) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" });
    return result.status === 0 ? result.stdout : undefined;
}

export function spawnRuntime(command, args) {
    return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
}

export function runStartSelector(dependencies = {}) {
    const readVersion = dependencies.readVersion ?? probeVersion;
    const run = dependencies.run ?? spawnRuntime;

    const runtime = selectRuntime({
        bunVersion: readVersion("bun"),
        nodeVersion: readVersion("node"),
    });
    if (!runtime) {
        process.stderr.write(`${UNSUPPORTED_MESSAGE}\n`);
        return 127;
    }

    return run(runtime, [LAUNCHER]);
}

export function runIfDirect(moduleUrl, argvPath, dependencies = {}) {
    if (!argvPath || moduleUrl !== pathToFileURL(argvPath).href) return null;
    return runStartSelector(dependencies);
}

const directExitCode = runIfDirect(import.meta.url, process.argv[1]);
if (directExitCode !== null) process.exitCode = directExitCode;
