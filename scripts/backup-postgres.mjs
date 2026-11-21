#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BACKUP_DIR = "/srv/backups/basishacks";
const DEFAULT_RETENTION_DAYS = 14;
const SNAPSHOT_PATTERN =
    /^(?:basishacks-\d{4}-\d{2}-\d{2}T[\d-]+Z\.dump|assets-\d{4}-\d{2}-\d{2}T[\d-]+Z\.tar\.gz)$/;

export function backupTimestamp(date = new Date()) {
    return date.toISOString().replaceAll(/[:.]/g, "-");
}

export function backupFileName(date = new Date()) {
    return `basishacks-${backupTimestamp(date)}.dump`;
}

/** Names of managed snapshots older than the retention window. */
export function selectExpiredSnapshots(entries, now, retentionDays) {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    return entries
        .filter((entry) => SNAPSHOT_PATTERN.test(entry.name) && entry.mtimeMs < cutoff)
        .map((entry) => entry.name);
}

export function databaseEnvironment(value) {
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

async function sha256File(path) {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex");
}

/** Publish a verified file at its final path with a sidecar checksum. */
async function publishVerified(outputPath, partialPath) {
    await rename(partialPath, outputPath);
    await chmod(outputPath, 0o600);
    const digest = await sha256File(outputPath);
    const checksumPath = `${outputPath}.sha256`;
    if (existsSync(checksumPath)) throw new Error(`Refusing to overwrite ${checksumPath}.`);
    await chmod(await writeChecksum(checksumPath, digest, outputPath), 0o600);
    return digest;
}

async function writeChecksum(checksumPath, digest, outputPath) {
    await writeFile(checksumPath, `${digest}  ${outputPath.split(/[\\/]/).pop()}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    return checksumPath;
}

async function backupAssets(outputDir, environment, stamp) {
    const assetsPath = resolve(projectRoot, "assets");
    if (!existsSync(assetsPath)) return undefined;
    const archivePath = resolve(outputDir, `assets-${stamp}.tar.gz`);
    if (existsSync(archivePath)) throw new Error(`Refusing to overwrite ${archivePath}.`);
    const partialPath = `${archivePath}.${process.pid}.partial`;
    await unlink(partialPath).catch(() => undefined);
    try {
        await run("tar", ["-czf", partialPath, "-C", projectRoot, "assets"], environment);
        await publishVerified(archivePath, partialPath);
    } catch (error) {
        await unlink(partialPath).catch(() => undefined);
        throw error;
    }
    const archive = await stat(archivePath);
    console.info(`Assets snapshot: ${archivePath} (${archive.size} bytes).`);
    return archivePath;
}

async function pruneExpiredSnapshots(outputDir, retentionDays) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) return [];
    let entries;
    try {
        entries = await readdir(outputDir, { withFileTypes: true });
    } catch {
        return [];
    }
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !SNAPSHOT_PATTERN.test(entry.name)) continue;
        const file = await stat(resolve(outputDir, entry.name));
        files.push({ name: entry.name, mtimeMs: file.mtimeMs });
    }
    const expired = selectExpiredSnapshots(files, Date.now(), retentionDays);
    for (const name of expired) {
        await unlink(resolve(outputDir, name)).catch(() => undefined);
        await unlink(resolve(outputDir, `${name}.sha256`)).catch(() => undefined);
    }
    return expired;
}

async function syncOffsite(outputDir, environment) {
    const target = environment.BACKUP_RSYNC_TARGET?.trim();
    if (!target) return;
    await run("rsync", ["-a", "--delete", `${outputDir}/`, target], environment);
    console.info(`Off-box sync complete: ${target}`);
}

async function restoreCheck(dumpPath, environment, confirmed) {
    if (!confirmed) {
        throw new Error(
            "Restore checks need --confirm-scratch-restore and PG_RESTORE_SCRATCH_URL; refusing to touch a database.",
        );
    }
    const scratch = environment.PG_RESTORE_SCRATCH_URL;
    if (!scratch) throw new Error("Set PG_RESTORE_SCRATCH_URL to an expendable scratch database.");
    const { environment: scratchEnvironment } = databaseEnvironment(scratch);
    await run(
        environment.PG_RESTORE_BIN || "pg_restore",
        [
            "--exit-on-error",
            "--clean",
            "--if-exists",
            `--dbname=${scratchEnvironment.PGDATABASE}`,
            dumpPath,
        ],
        scratchEnvironment,
    );
    console.info(`Restored ${dumpPath} into scratch database ${scratchEnvironment.PGDATABASE}.`);
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const outputIndex = argv.indexOf("--output");
    const outputArgument = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
    const retentionIndex = argv.indexOf("--retention-days");
    const retentionArgument = retentionIndex >= 0 ? argv[retentionIndex + 1] : undefined;
    const withAssets = argv.includes("--with-assets");
    const restoreIndex = argv.indexOf("--restore-check");
    const restorePath = restoreIndex >= 0 ? argv[restoreIndex + 1] : undefined;
    const allowRestore = argv.includes("--confirm-scratch-restore");
    const known = new Set([
        "--output",
        outputArgument,
        "--retention-days",
        retentionArgument,
        "--with-assets",
        "--restore-check",
        restorePath,
        "--confirm-scratch-restore",
    ]);
    if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env before taking a snapshot.");
    if (outputIndex >= 0 && !outputArgument) throw new Error("Pass a path after --output.");
    if (retentionIndex >= 0 && !/^\d+$/.test(retentionArgument ?? "")) {
        throw new Error("Pass a whole number of days after --retention-days.");
    }
    if (argv.some((argument) => !known.has(argument))) {
        throw new Error(
            "Usage: node scripts/backup-postgres.mjs [--output <path>] [--with-assets] [--retention-days <days>] [--restore-check <dump> --confirm-scratch-restore]",
        );
    }

    const { database, environment } = databaseEnvironment(env.DATABASE_URL);
    if (restorePath) {
        await restoreCheck(resolve(restorePath), env, allowRestore);
        return;
    }

    const backupDir = resolve(env.BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR);
    const explicitOutput = outputArgument ? resolve(projectRoot, outputArgument) : undefined;
    if (explicitOutput) {
        const relativePath = relative(projectRoot, explicitOutput);
        if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
            throw new Error(
                "The PostgreSQL snapshot path must remain inside the project workspace.",
            );
        }
    }
    const outputPath = explicitOutput ?? resolve(backupDir, backupFileName());
    if (existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}.`);

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
        // `--list` only parses the TOC, so a truncated data section still passes.
        // Emitting SQL to stdout forces pg_restore through every data block,
        // which catches corruption before the snapshot is published.
        await run(
            env.PG_RESTORE_BIN || "pg_restore",
            ["--exit-on-error", "--file=-", partialPath],
            environment,
            { quiet: true },
        );
        await publishVerified(outputPath, partialPath);
        published = true;
    } finally {
        if (!published) await unlink(partialPath).catch(() => undefined);
    }

    const backup = await stat(outputPath);
    console.info(
        `Created and verified PostgreSQL snapshot for ${database}: ${outputPath} (${backup.size} bytes).`,
    );

    if (withAssets) {
        await backupAssets(dirname(outputPath), environment, backupTimestamp());
    }

    const retentionDays =
        retentionIndex >= 0
            ? Number(retentionArgument)
            : Number(env.BACKUP_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
    const pruned = await pruneExpiredSnapshots(dirname(outputPath), retentionDays);
    if (pruned.length > 0) {
        console.info(`Pruned ${pruned.length} expired backup file(s): ${pruned.join(", ")}`);
    }

    await syncOffsite(dirname(outputPath), env);
}

// Restore a verified custom-format dump into an expendable database:
//   pg_restore --exit-on-error --clean --if-exists --dbname=<scratch> <dump>
// Or run: node scripts/backup-postgres.mjs \
//   --restore-check <dump> --confirm-scratch-restore
// with PG_RESTORE_SCRATCH_URL=postgresql://... (never point this at production).
const isDirectExecution =
    Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
    main().catch((error) => {
        console.error(
            `[PostgreSQL snapshot] ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    });
}

export { main };
