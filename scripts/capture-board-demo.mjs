#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const databaseUrl = process.env.BASISHACKS_E2E_DATABASE_URL;
const appOrigin = process.env.PLAYWRIGHT_BASE_URL;

function assertDatabaseIsolated(value) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error("Set BASISHACKS_E2E_DATABASE_URL in .env to the isolated E2E database.");
    }
    if (
        !["postgres:", "postgresql:"].includes(parsed.protocol) ||
        !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
        decodeURIComponent(parsed.pathname.slice(1)) !== "basishacks_e2e"
    ) {
        throw new Error(
            "Board demo capture requires a loopback PostgreSQL database named basishacks_e2e.",
        );
    }
}

if (!databaseUrl) {
    throw new Error("Set BASISHACKS_E2E_DATABASE_URL in .env before capturing the board demo.");
}
assertDatabaseIsolated(databaseUrl);
if (!appOrigin) throw new Error("Set PLAYWRIGHT_BASE_URL in .env before capturing the board demo.");

const appUrl = new URL(appOrigin);
if (appUrl.protocol !== "http:" || appUrl.hostname !== "127.0.0.1" || !appUrl.port) {
    throw new Error("PLAYWRIGHT_BASE_URL must be a loopback HTTP origin with an explicit port.");
}

const playwrightCli = resolve(projectRoot, "node_modules/@playwright/test/cli.js");

async function resetDemoDatabase() {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
    try {
        await sql.unsafe("DROP SCHEMA public CASCADE");
        await sql.unsafe("CREATE SCHEMA public");
    } finally {
        await sql.end({ timeout: 5 });
    }
}

await resetDemoDatabase();
console.info("Reset the dedicated basishacks_e2e database for a clean demo run.");
let result;
try {
    result = spawnSync(
        process.execPath,
        [
            playwrightCli,
            "test",
            "e2e/browser/role-journeys.spec.ts",
            "--grep",
            "participant and admin complete mobile journeys",
            "--workers=1",
        ],
        {
            cwd: projectRoot,
            env: { ...process.env, BOARD_DEMO_CAPTURE: "1" },
            stdio: "inherit",
            windowsHide: true,
        },
    );
} finally {
    await resetDemoDatabase();
    console.info("Cleared the isolated demo database after capture.");
}

if (result?.error) throw result.error;
if (result?.status !== 0) process.exitCode = result?.status ?? 1;
