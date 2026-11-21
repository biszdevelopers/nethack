import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const originalRestoreBinary = process.env.PG_RESTORE_BIN;

type Outcome = { code?: number | null; signal?: string | null; stderr?: string; error?: unknown };

interface HarnessOptions {
    env?: Record<string, string | undefined>;
    outcomes?: Outcome[];
    assetsExists?: boolean;
    archiveExists?: boolean;
    checksumExists?: boolean;
    readdirEntries?: Array<{ name: string; isFile: () => boolean }>;
    readdirError?: boolean;
    mtimeMs?: number;
    unlinkError?: boolean;
}

const createSpawn = (outcomes: Outcome[]) => {
    const queue = [...outcomes];
    return vi.fn(() => {
        const outcome = queue.shift() ?? { code: 0 };
        const stderrHandlers: Array<(chunk: unknown) => void> = [];
        const child: any = {
            stderr: {
                on(event: string, handler: (chunk: unknown) => void) {
                    if (event === "data") stderrHandlers.push(handler);
                    return child.stderr;
                },
            },
            once(event: string, handler: (...args: any[]) => void) {
                if (event === "error" && outcome.error) {
                    queueMicrotask(() => handler(outcome.error));
                }
                if (event === "exit" && !outcome.error) {
                    queueMicrotask(() => {
                        if (outcome.stderr) stderrHandlers.forEach((emit) => emit(outcome.stderr));
                        handler(outcome.code ?? 0, outcome.signal ?? null);
                    });
                }
                return child;
            },
        };
        return child;
    });
};

async function harness(options: HarnessOptions = {}) {
    vi.resetModules();
    const spawn = createSpawn(options.outcomes ?? []);
    const checksumWrites: string[] = [];
    const unlink = vi.fn(async () => {
        if (options.unlinkError) throw new Error("unlink denied");
    });
    const readdir = vi.fn(async () => {
        if (options.readdirError) throw new Error("unreadable");
        return options.readdirEntries ?? [];
    });
    const stat = vi.fn(async () => ({ size: 42, mtimeMs: options.mtimeMs ?? 0 }));
    const writeFile = vi.fn(async (_path: string, content: string) => {
        checksumWrites.push(content);
    });
    const fs = {
        chmod: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from("dump")),
        readdir,
        rename: vi.fn(async () => undefined),
        stat,
        unlink,
        writeFile,
    };
    const assetsPath = resolve(repositoryRoot, "assets");
    const existsSync = vi.fn((path: string) => {
        if (path === assetsPath) return options.assetsExists ?? false;
        if (path.endsWith(".tar.gz")) return options.archiveExists ?? false;
        if (path.endsWith(".sha256")) return options.checksumExists ?? false;
        return false;
    });
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:fs/promises", () => fs);
    vi.doMock("node:fs", () => ({ existsSync }));
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const module = await import("../../scripts/backup-postgres.mjs");
    const environment = {
        DATABASE_URL: "postgres://localhost/app",
        ...options.env,
    };
    return {
        main: module.main as (argv: string[], env: Record<string, unknown>) => Promise<void>,
        spawn,
        fs,
        existsSync,
        checksumWrites,
        environment,
    };
}

const settle = async () => {
    for (let index = 0; index < 10; index += 1) {
        await new Promise((done) => setTimeout(done, 0));
    }
};

afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalRestoreBinary === undefined) delete process.env.PG_RESTORE_BIN;
    else process.env.PG_RESTORE_BIN = originalRestoreBinary;
});

describe("PostgreSQL backup assets, retention, and off-box sync", () => {
    it("verifies the dump, archives assets, prunes expired files, and syncs off-box", async () => {
        const expired = "basishacks-2020-01-01T00-00-00-000Z.dump";
        const run = await harness({
            env: { BACKUP_RSYNC_TARGET: "backup@host:/srv/backups" },
            outcomes: [{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }],
            assetsExists: true,
            readdirEntries: [
                { name: expired, isFile: () => true },
                { name: "notes.txt", isFile: () => true },
            ],
            mtimeMs: Date.now() - 20 * 24 * 60 * 60 * 1000,
        });
        const outputPath = resolve(repositoryRoot, "backups/snap.dump");

        await run.main(
            ["--output", "backups/snap.dump", "--with-assets", "--retention-days", "7"],
            run.environment,
        );
        await settle();

        const tarCall = run.spawn.mock.calls[2];
        expect(tarCall?.[0]).toBe("tar");
        expect(tarCall?.[1]?.[0]).toBe("-czf");
        expect(tarCall?.[1]?.[1]).toMatch(/assets-.+\.tar\.gz\.\d+\.partial$/);
        expect(tarCall?.[1]).toContain("-C");
        expect(tarCall?.[1]).toContain(repositoryRoot);
        expect(tarCall?.[1]?.at(-1)).toBe("assets");

        expect(run.spawn.mock.calls[3]?.[0]).toBe("rsync");
        expect(run.spawn.mock.calls[3]?.[1]).toEqual([
            "-a",
            "--delete",
            `${resolve(repositoryRoot, "backups")}/`,
            "backup@host:/srv/backups",
        ]);

        expect(run.fs.chmod).toHaveBeenCalledWith(outputPath, 0o600);
        expect(run.checksumWrites[0]).toMatch(/^[a-f0-9]{64}\s{2}snap\.dump\n$/);
        expect(run.fs.unlink).toHaveBeenCalledWith(resolve(repositoryRoot, "backups", expired));
        expect(run.fs.unlink).toHaveBeenCalledWith(
            resolve(repositoryRoot, "backups", `${expired}.sha256`),
        );
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Assets snapshot:"));
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("Pruned 1 expired backup file(s)"),
        );
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("Off-box sync complete: backup@host:/srv/backups"),
        );
    });

    it("keeps the backup available when assets are absent", async () => {
        const run = await harness({
            outcomes: [{ code: 0 }, { code: 0 }],
            assetsExists: false,
        });

        await run.main(["--output", "snap.dump", "--with-assets"], run.environment);
        await settle();

        expect(run.spawn).toHaveBeenCalledTimes(2);
        expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining("Assets snapshot:"));
    });

    it("refuses to overwrite an existing assets archive", async () => {
        const run = await harness({
            outcomes: [{ code: 0 }, { code: 0 }],
            assetsExists: true,
            archiveExists: true,
        });

        await expect(
            run.main(["--output", "snap.dump", "--with-assets"], run.environment),
        ).rejects.toThrow("Refusing to overwrite");
        expect(run.spawn).toHaveBeenCalledTimes(2);
    });

    it("removes the partial assets archive when tar fails", async () => {
        const run = await harness({
            outcomes: [{ code: 0 }, { code: 0 }, { code: 1, stderr: "tar broken" }],
            assetsExists: true,
            unlinkError: true,
        });

        await expect(
            run.main(["--output", "snap.dump", "--with-assets"], run.environment),
        ).rejects.toThrow("tar exited with code 1. tar broken");

        const partial = run.spawn.mock.calls[2]?.[1]?.[1];
        expect(run.fs.unlink).toHaveBeenCalledWith(partial);
    });

    it("refuses to overwrite an existing checksum sidecar", async () => {
        const run = await harness({
            outcomes: [{ code: 0 }, { code: 0 }],
            checksumExists: true,
        });
        const outputPath = resolve(repositoryRoot, "snap.dump");

        await expect(run.main(["--output", "snap.dump"], run.environment)).rejects.toThrow(
            `Refusing to overwrite ${outputPath}.sha256`,
        );
    });
});

describe("PostgreSQL backup retention boundaries", () => {
    it("skips pruning for a non-positive retention window", async () => {
        const run = await harness({ outcomes: [{ code: 0 }, { code: 0 }] });

        await run.main(["--output", "snap.dump", "--retention-days", "0"], run.environment);
        await settle();

        expect(run.fs.readdir).not.toHaveBeenCalled();
    });

    it("tolerates an unreadable backup directory", async () => {
        const run = await harness({
            env: { BACKUP_RETENTION_DAYS: "7" },
            outcomes: [{ code: 0 }, { code: 0 }],
            readdirError: true,
        });

        await expect(run.main(["--output", "snap.dump"], run.environment)).resolves.toBeUndefined();
        expect(run.fs.readdir).toHaveBeenCalledOnce();
    });

    it("swallows cleanup errors for expired snapshots and their sidecars", async () => {
        const expired = "assets-2020-01-01T00-00-00-000Z.tar.gz";
        const run = await harness({
            env: { BACKUP_RETENTION_DAYS: "7" },
            outcomes: [{ code: 0 }, { code: 0 }],
            readdirEntries: [
                { name: "directory", isFile: () => false },
                { name: "unmanaged.txt", isFile: () => true },
                { name: expired, isFile: () => true },
            ],
            mtimeMs: Date.now() - 20 * 24 * 60 * 60 * 1000,
            unlinkError: true,
        });

        await expect(run.main(["--output", "snap.dump"], run.environment)).resolves.toBeUndefined();

        expect(run.fs.stat).toHaveBeenCalledWith(resolve(repositoryRoot, expired));
        expect(run.fs.unlink).toHaveBeenCalledTimes(3);
    });

    it("falls back to the default backup directory and retention while skipping off-box sync", async () => {
        const run = await harness({ outcomes: [{ code: 0 }, { code: 0 }] });

        await run.main([], run.environment);
        await settle();

        const fileArgument = run.spawn.mock.calls[0]?.[1]?.at(-1) as string;
        expect(fileArgument).toMatch(/basishacks-.+\.dump\.\d+\.partial$/);
        expect(fileArgument.replaceAll("\\", "/")).toContain("/srv/backups/basishacks/");
        expect(run.fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("srv"), {
            recursive: true,
        });
        expect(run.spawn).toHaveBeenCalledTimes(2);
    });

    it("rejects a retention flag without a value", async () => {
        const run = await harness();

        await expect(run.main(["--retention-days"], run.environment)).rejects.toThrow(
            "whole number of days",
        );
    });
});

describe("PostgreSQL restore-check execution", () => {
    it("restores into an expendable scratch database with the default binary", async () => {
        const run = await harness({
            env: { PG_RESTORE_SCRATCH_URL: "postgres://localhost/scratch" },
            outcomes: [{ code: 0 }],
        });

        await run.main(
            ["--restore-check", "dump.dump", "--confirm-scratch-restore"],
            run.environment,
        );

        expect(run.spawn).toHaveBeenCalledWith(
            "pg_restore",
            ["--exit-on-error", "--clean", "--if-exists", "--dbname=scratch", resolve("dump.dump")],
            expect.objectContaining({
                env: expect.objectContaining({ PGDATABASE: "scratch" }),
            }),
        );
    });

    it("restores into an expendable scratch database with a custom binary", async () => {
        const run = await harness({
            env: {
                PG_RESTORE_SCRATCH_URL: "postgres://localhost/scratch",
                PG_RESTORE_BIN: "custom-restore",
            },
            outcomes: [{ code: 0 }],
        });

        await run.main(
            ["--restore-check", "dump.dump", "--confirm-scratch-restore"],
            run.environment,
        );

        expect(run.spawn).toHaveBeenCalledWith(
            "custom-restore",
            ["--exit-on-error", "--clean", "--if-exists", "--dbname=scratch", resolve("dump.dump")],
            expect.objectContaining({
                env: expect.objectContaining({ PGDATABASE: "scratch" }),
            }),
        );
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("into scratch database scratch"),
        );
    });
});
