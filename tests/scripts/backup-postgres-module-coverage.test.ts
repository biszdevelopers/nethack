import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = fileURLToPath(new URL("../../scripts/backup-postgres.mjs", import.meta.url));
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

type SpawnOutcome =
    | "success"
    | { code: number | null; signal?: string | null }
    | { error: unknown };

interface RunOptions {
    argv?: string[];
    databaseUrl?: string;
    dumpBinary?: string;
    restoreBinary?: string;
    outcomes?: SpawnOutcome[];
    exists?: boolean;
    statSize?: number;
}

const createSpawn = (outcomes: SpawnOutcome[]) => {
    const queue = [...outcomes];
    return vi.fn(() => {
        const outcome = queue.shift() ?? "success";
        const child = {
            once(event: string, handler: (...handlerArguments: never[]) => void) {
                if (event === "exit") {
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
    const existsSync = vi.fn(() => options.exists ?? false);
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:fs/promises", () => ({ mkdir, stat }));
    vi.doMock("node:fs", () => ({ existsSync }));
    vi.stubEnv("DATABASE_URL", options.databaseUrl ?? "");
    vi.stubEnv("PG_DUMP_BIN", options.dumpBinary ?? "");
    vi.stubEnv("PG_RESTORE_BIN", options.restoreBinary ?? "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [process.execPath, scriptPath, ...(options.argv ?? [])];
    process.exitCode = 0;

    await import("../../scripts/backup-postgres.mjs");
    await settle();

    return { spawn, mkdir, stat, existsSync, info, errorLog, exitCode: process.exitCode };
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
        const environment = run.spawn.mock.calls[0]?.[2]?.env;

        expect(run.spawn).toHaveBeenNthCalledWith(
            1,
            "pg_dump",
            ["--format=custom", "--no-owner", "--no-privileges", `--file=${outputPath}`],
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
            ["--list", outputPath],
            expect.objectContaining({ stdio: "ignore", windowsHide: true }),
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
                `^--file=${repositoryRoot.replaceAll("\\", "\\\\")}[\\\\/]\\.tmp-postgres-.+\\.dump$`,
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
        expect(run.spawn.mock.calls[1]?.[2]?.stdio).toBe("ignore");
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
            message: "Usage: node scripts/backup-postgres.mjs [--output <workspace path>]",
        },
        {
            name: "extra trailing argument",
            argv: ["--output", "snapshot.dump", "extra"],
            message: "Usage: node scripts/backup-postgres.mjs [--output <workspace path>]",
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
