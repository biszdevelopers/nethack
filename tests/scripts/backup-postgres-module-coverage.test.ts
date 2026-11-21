import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = fileURLToPath(new URL("../../scripts/backup-postgres.mjs", import.meta.url));
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

type SpawnOutcome =
    | "success"
    | { code: number | null; signal?: string | null; stderr?: string }
    | { error: unknown };

interface RunOptions {
    argv?: string[];
    databaseUrl?: string;
    dumpBinary?: string;
    restoreBinary?: string;
    outcomes?: SpawnOutcome[];
    exists?: boolean;
    statSize?: number;
    unlinkFailure?: boolean | "all";
}

const createSpawn = (outcomes: SpawnOutcome[]) => {
    const queue = [...outcomes];
    return vi.fn(() => {
        const outcome = queue.shift() ?? "success";
        const stderrHandlers: Array<(chunk: unknown) => void> = [];
        const stderr = {
            on(event: string, handler: (chunk: unknown) => void) {
                if (event === "data") stderrHandlers.push(handler);
                return stderr;
            },
        };
        const child = {
            stderr,
            once(event: string, handler: (...handlerArguments: never[]) => void) {
                if (event === "exit") {
                    if (typeof outcome !== "string" && "code" in outcome && outcome.stderr) {
                        queueMicrotask(() =>
                            stderrHandlers.forEach((emit) => emit(outcome.stderr)),
                        );
                    }
                    if (outcome === "success")
                        queueMicrotask(() =>
                            (handler as (code: number, signal: null) => void)(0, null),
                        );
                    else if (typeof outcome !== "string" && "code" in outcome)
                        queueMicrotask(() =>
                            (handler as (code: number | null, signal: string | null) => void)(
                                outcome.code,
                                outcome.signal ?? null,
                            ),
                        );
                } else if (event === "error" && typeof outcome !== "string" && "error" in outcome) {
                    queueMicrotask(() => (handler as (error: unknown) => void)(outcome.error));
                }
                return child;
            },
        };
        return child;
    });
};

const settle = async () => {
    for (let index = 0; index < 10; index += 1)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
};

const runScript = async (options: RunOptions = {}) => {
    vi.resetModules();
    const spawn = createSpawn(options.outcomes ?? []);
    const mkdir = vi.fn(async () => undefined);
    const stat = vi.fn(async () => ({ size: options.statSize ?? 42 }));
    const rename = vi.fn(async () => undefined);
    const chmod = vi.fn(async () => undefined);
    const readFile = vi.fn(async () => Buffer.from("dump"));
    const writeFile = vi.fn(async () => undefined);
    const readdir = vi.fn(async () => []);
    let unlinkCalls = 0;
    const unlink = vi.fn(async () => {
        unlinkCalls += 1;
        if (
            options.unlinkFailure === "all" ||
            (options.unlinkFailure === true && unlinkCalls === 1)
        ) {
            throw new Error("cleanup unavailable");
        }
    });
    const existsSync = vi.fn(() => options.exists ?? false);
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:fs/promises", () => ({
        chmod,
        mkdir,
        readdir,
        readFile,
        rename,
        stat,
        unlink,
        writeFile,
    }));
    vi.doMock("node:fs", () => ({ existsSync }));
    vi.stubEnv("DATABASE_URL", options.databaseUrl ?? "");
    vi.stubEnv("PG_DUMP_BIN", options.dumpBinary ?? "");
    vi.stubEnv("PG_RESTORE_BIN", options.restoreBinary ?? "");
    vi.stubEnv("BACKUP_DIR", repositoryRoot);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [process.execPath, scriptPath, ...(options.argv ?? [])];
    process.exitCode = 0;

    await import("../../scripts/backup-postgres.mjs");
    await settle();

    return {
        spawn,
        mkdir,
        chmod,
        readFile,
        writeFile,
        readdir,
        stat,
        rename,
        unlink,
        existsSync,
        info,
        errorLog,
        exitCode: process.exitCode,
    };
};

afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.doUnmock("node:fs");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("PostgreSQL snapshot script", () => {
    it("dumps and verifies a snapshot with every connection option translated", async () => {
        const run = await runScript({
            argv: ["--output", ".tmp/snapshot.dump"],
            databaseUrl:
                "postgres://user%40example:p%40ss@db.example.test:6543/app%20db?sslmode=require&application_name=basishacks&options=-c%20search_path%3Dpublic&connect_timeout=30",
            statSize: 4096,
        });
        const outputPath = resolve(repositoryRoot, ".tmp/snapshot.dump");
        const partialPath = `${outputPath}.${process.pid}.partial`;
        const environment = run.spawn.mock.calls[0]?.[2]?.env;

        expect(run.spawn).toHaveBeenNthCalledWith(
            1,
            "pg_dump",
            ["--format=custom", "--no-owner", "--no-privileges", `--file=${partialPath}`],
            expect.objectContaining({
                cwd: repositoryRoot,
                stdio: "inherit",
                windowsHide: true,
                env: expect.objectContaining({
                    PGHOST: "db.example.test",
                    PGPORT: "6543",
                    PGDATABASE: "app db",
                    PGUSER: "user@example",
                    PGPASSWORD: "p@ss",
                    PGCONNECT_TIMEOUT: "30",
                    PGSSLMODE: "require",
                    PGAPPNAME: "basishacks",
                    PGOPTIONS: "-c search_path=public",
                }),
            }),
        );
        expect(environment).toBeDefined();
        expect(run.spawn).toHaveBeenNthCalledWith(
            2,
            "pg_restore",
            ["--exit-on-error", "--file=-", partialPath],
            expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"], windowsHide: true }),
        );
        expect(run.mkdir).toHaveBeenCalledWith(resolve(repositoryRoot, ".tmp"), {
            recursive: true,
        });
        expect(run.info).toHaveBeenCalledWith(
            `Created and verified PostgreSQL snapshot for app db: ${outputPath} (4096 bytes).`,
        );
        expect(run.errorLog).not.toHaveBeenCalled();
        expect(run.exitCode).toBe(0);
    });

    it("uses a timestamped default name, default ports, and custom binaries", async () => {
        const run = await runScript({
            databaseUrl: "postgresql://localhost/plain",
            dumpBinary: "custom-dump",
            restoreBinary: "custom-restore",
        });
        const firstCall = run.spawn.mock.calls[0];
        const environment = firstCall?.[2]?.env;

        expect(firstCall?.[0]).toBe("custom-dump");
        expect(firstCall?.[1]).toHaveLength(4);
        expect(firstCall?.[1]?.[3]).toMatch(
            new RegExp(
                `^--file=${repositoryRoot.replaceAll("\\", "\\\\")}[\\\\/]basishacks-.+\\.dump\\.${process.pid}\\.partial$`,
            ),
        );
        expect(environment).toEqual(
            expect.objectContaining({
                PGHOST: "localhost",
                PGPORT: "5432",
                PGDATABASE: "plain",
                PGUSER: "",
                PGPASSWORD: "",
                PGCONNECT_TIMEOUT: "10",
            }),
        );
        expect(environment && "PGSSLMODE" in environment).toBe(false);
        expect(environment && "PGAPPNAME" in environment).toBe(false);
        expect(environment && "PGOPTIONS" in environment).toBe(false);
        expect(run.spawn.mock.calls[1]?.[0]).toBe("custom-restore");
        expect(run.spawn.mock.calls[1]?.[2]?.stdio).toEqual(["ignore", "ignore", "pipe"]);
        expect(run.info).toHaveBeenCalledWith(
            expect.stringContaining("Created and verified PostgreSQL snapshot for plain:"),
        );
        expect(run.exitCode).toBe(0);
    });

    it.each([
        {
            name: "missing database URL",
            databaseUrl: undefined,
            message: "Set DATABASE_URL in .env before taking a snapshot.",
        },
        {
            name: "malformed database URL",
            databaseUrl: "not a url",
            message: "DATABASE_URL must be a valid PostgreSQL connection URL.",
        },
        {
            name: "non-PostgreSQL protocol",
            databaseUrl: "mysql://localhost/app",
            message: "DATABASE_URL must use the PostgreSQL protocol.",
        },
        {
            name: "empty database name",
            databaseUrl: "postgres://localhost/",
            message: "DATABASE_URL must include one database name.",
        },
        {
            name: "multiple path segments",
            databaseUrl: "postgres://localhost/app/extra",
            message: "DATABASE_URL must include one database name.",
        },
    ])("rejects a $name", async ({ databaseUrl, message }) => {
        const run = await runScript({ databaseUrl });

        expect(run.errorLog).toHaveBeenCalledWith(`[PostgreSQL snapshot] ${message}`);
        expect(run.exitCode).toBe(1);
        expect(run.spawn).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: "missing output path",
            argv: ["--output"],
            message: "Pass a path after --output.",
        },
        {
            name: "unexpected argument",
            argv: ["unexpected"],
            message:
                "Usage: node scripts/backup-postgres.mjs [--output <path>] [--with-assets] [--retention-days <days>] [--restore-check <dump> --confirm-scratch-restore]",
        },
        {
            name: "extra trailing argument",
            argv: ["--output", "snapshot.dump", "extra"],
            message:
                "Usage: node scripts/backup-postgres.mjs [--output <path>] [--with-assets] [--retention-days <days>] [--restore-check <dump> --confirm-scratch-restore]",
        },
    ])("rejects a $name", async ({ argv, message }) => {
        const run = await runScript({ argv, databaseUrl: "postgres://localhost/app" });

        expect(run.errorLog).toHaveBeenCalledWith(`[PostgreSQL snapshot] ${message}`);
        expect(run.exitCode).toBe(1);
        expect(run.spawn).not.toHaveBeenCalled();
    });

    it.each([
        { name: "parent directory", output: ".." },
        { name: "nested parent directory", output: "../escape.dump" },
    ])("refuses an output path in the $name", async ({ output }) => {
        const run = await runScript({
            argv: ["--output", output],
            databaseUrl: "postgres://localhost/app",
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] The PostgreSQL snapshot path must remain inside the project workspace.",
        );
        expect(run.exitCode).toBe(1);
        expect(run.spawn).not.toHaveBeenCalled();
    });

    it("refuses to overwrite an existing snapshot", async () => {
        const run = await runScript({
            argv: ["--output", "existing.dump"],
            databaseUrl: "postgres://localhost/app",
            exists: true,
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            `[PostgreSQL snapshot] Refusing to overwrite ${resolve(repositoryRoot, "existing.dump")}.`,
        );
        expect(run.exitCode).toBe(1);
        expect(run.spawn).not.toHaveBeenCalled();
    });

    it("reports a pg_dump exit code failure", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: [{ code: 2 }],
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] pg_dump exited with code 2.",
        );
        expect(run.spawn).toHaveBeenCalledOnce();
        expect(run.exitCode).toBe(1);
    });

    it("reports a pg_dump termination signal", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: [{ code: null, signal: "SIGKILL" }],
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] pg_dump exited with SIGKILL.",
        );
        expect(run.exitCode).toBe(1);
    });

    it("removes the partial dump on failure so the output path stays reusable", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: ["success", { code: 1 }],
        });

        expect(run.rename).not.toHaveBeenCalled();
        expect(run.unlink).toHaveBeenCalledTimes(2);
        expect(run.unlink).toHaveBeenCalledWith(
            resolve(repositoryRoot, `snapshot.dump.${process.pid}.partial`),
        );
        expect(run.exitCode).toBe(1);
    });

    it("tolerates a failed pre-run partial cleanup and reports verification stderr", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: ["success", { code: 1, stderr: "corrupt dump" }],
            unlinkFailure: true,
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] pg_restore exited with code 1. corrupt dump",
        );
        expect(run.exitCode).toBe(1);
    });

    it("swallows a failed cleanup after a failed dump", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: [{ code: null, signal: "SIGKILL" }],
            unlinkFailure: "all",
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] pg_dump exited with SIGKILL.",
        );
        expect(run.exitCode).toBe(1);
    });

    it("reports a pg_restore verification failure", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: ["success", { code: 1 }],
        });

        expect(run.errorLog).toHaveBeenCalledWith(
            "[PostgreSQL snapshot] pg_restore exited with code 1.",
        );
        expect(run.spawn).toHaveBeenCalledTimes(2);
        expect(run.info).not.toHaveBeenCalled();
        expect(run.exitCode).toBe(1);
    });

    it("reports a spawn error object", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: [{ error: new Error("spawn ENOENT") }],
        });

        expect(run.errorLog).toHaveBeenCalledWith("[PostgreSQL snapshot] spawn ENOENT");
        expect(run.exitCode).toBe(1);
    });

    it("stringifies a non-Error spawn rejection", async () => {
        const run = await runScript({
            argv: ["--output", "snapshot.dump"],
            databaseUrl: "postgres://localhost/app",
            outcomes: [{ error: "spawn broke" }],
        });

        expect(run.errorLog).toHaveBeenCalledWith("[PostgreSQL snapshot] spawn broke");
        expect(run.exitCode).toBe(1);
    });
});
