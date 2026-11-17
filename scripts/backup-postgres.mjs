#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function databaseEnvironment(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
    }
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || url.pathname.split("/").length !== 2) {
        throw new Error("DATABASE_URL must include one database name.");
    }

    const environment = {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGDATABASE: database,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGCONNECT_TIMEOUT: url.searchParams.get("connect_timeout") ?? "10",
    };
    const sslMode = url.searchParams.get("sslmode");
    const appName = url.searchParams.get("application_name");
    const options = url.searchParams.get("options");
    if (sslMode) environment.PGSSLMODE = sslMode;
    if (appName) environment.PGAPPNAME = appName;
    if (options) environment.PGOPTIONS = options;
    return { database, environment };
}

function run(program, args, environment, { quiet = false } = {}) {
    return new Promise((resolvePromise, reject) => {
        let stderr = "";
        const child = spawn(program, args, {
            cwd: projectRoot,
            env: environment,
            stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
            windowsHide: true,
        });
        child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) resolvePromise();
            else {
                const detail = stderr.trim();
                reject(
                    new Error(
                        `${program} exited with ${signal ?? `code ${code}`}.${detail ? ` ${detail}` : ""}`,
                    ),
                );
            }
        });
    });
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const outputIndex = argv.indexOf("--output");
    const outputArgument = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
    if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env before taking a snapshot.");
    if (outputIndex >= 0 && !outputArgument) throw new Error("Pass a path after --output.");
    if (argv.some((argument) => argument !== "--output" && argument !== outputArgument)) {
        throw new Error("Usage: node scripts/backup-postgres.mjs [--output <workspace path>]");
    }

    const defaultName = `.tmp-postgres-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.dump`;
    const outputPath = resolve(projectRoot, outputArgument ?? defaultName);
    const relativePath = relative(projectRoot, outputPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        throw new Error("The PostgreSQL snapshot path must remain inside the project workspace.");
    }
    if (existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}.`);

    const { database, environment } = databaseEnvironment(env.DATABASE_URL);
    await mkdir(dirname(outputPath), { recursive: true });

    // Write to a temporary file so a failed dump never leaves a partial file at
    // the final path (which would make every retry fail the overwrite guard).
    // The PID suffix keeps two concurrent runs from clobbering each other's dump.
    const partialPath = `${outputPath}.${process.pid}.partial`;
    await unlink(partialPath).catch(() => undefined);
    let published = false;
    try {
        await run(
            env.PG_DUMP_BIN || "pg_dump",
            ["--format=custom", "--no-owner", "--no-privileges", `--file=${partialPath}`],
            environment,
        );
        await run(env.PG_RESTORE_BIN || "pg_restore", ["--list", partialPath], environment, {
            quiet: true,
        });
        await rename(partialPath, outputPath);
        published = true;
    } finally {
        if (!published) await unlink(partialPath).catch(() => undefined);
    }

    const backup = await stat(outputPath);
    console.info(
        `Created and verified PostgreSQL snapshot for ${database}: ${outputPath} (${backup.size} bytes).`,
    );
}

main().catch((error) => {
    console.error(
        `[PostgreSQL snapshot] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
});
