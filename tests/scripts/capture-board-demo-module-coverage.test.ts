import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const originalExitCode = process.exitCode;

interface RunOptions {
    databaseUrl?: string;
    baseUrl?: string;
    failUnsafeAt?: number;
    spawnResult?: unknown;
    spawnError?: Error;
}

const settle = async () => {
    for (let index = 0; index < 10; index += 1)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
};

const runScript = async (options: RunOptions = {}) => {
    vi.resetModules();
    let unsafeCalls = 0;
    const unsafe = vi.fn(async () => {
        unsafeCalls += 1;
        if (unsafeCalls === options.failUnsafeAt) throw new Error("database unavailable");
        return [];
    });
    const end = vi.fn(async () => undefined);
    const sql = { unsafe, end };
    const postgresMock = vi.fn(() => sql);
    const spawnSync = vi.fn(() => {
        if (options.spawnError) throw options.spawnError;
        return "spawnResult" in options ? options.spawnResult : { status: 0, error: undefined };
    });
    vi.doMock("postgres", () => ({ default: postgresMock }));
    vi.doMock("node:child_process", () => ({ spawnSync }));
    vi.stubEnv("BASISHACKS_E2E_DATABASE_URL", options.databaseUrl ?? "");
    vi.stubEnv("PLAYWRIGHT_BASE_URL", options.baseUrl ?? "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    process.exitCode = 0;

    let error: unknown;
    try {
        await import("../../scripts/capture-board-demo.mjs");
    } catch (importError) {
        error = importError;
    }
    await settle();

    return {
        error,
        postgresMock,
        unsafe,
        end,
        spawnSync,
        info,
        exitCode: process.exitCode,
    };
};

afterEach(() => {
    process.exitCode = originalExitCode;
    vi.doUnmock("postgres");
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("board demo capture script", () => {
    it("resets the isolated database, runs the capture, and clears it again", async () => {
        const run = await runScript({
            databaseUrl: "postgresql://127.0.0.1:5432/basishacks%5Fe2e",
            baseUrl: "http://127.0.0.1:24598",
        });

        expect(run.error).toBeUndefined();
        expect(run.postgresMock).toHaveBeenCalledWith(
            "postgresql://127.0.0.1:5432/basishacks%5Fe2e",
            {
                max: 1,
                connect_timeout: 5,
            },
        );
        expect(run.unsafe.mock.calls.map(([statement]) => statement)).toEqual([
            "DROP SCHEMA public CASCADE",
            "CREATE SCHEMA public",
            "DROP SCHEMA public CASCADE",
            "CREATE SCHEMA public",
        ]);
        expect(run.end).toHaveBeenCalledTimes(2);
        expect(run.end).toHaveBeenCalledWith({ timeout: 5 });
        expect(run.spawnSync).toHaveBeenCalledWith(
            process.execPath,
            [
                resolve(repositoryRoot, "node_modules/@playwright/test/cli.js"),
                "test",
                "e2e/browser/role-journeys.spec.ts",
                "--grep",
                "participant and admin complete mobile journeys",
                "--workers=1",
            ],
            expect.objectContaining({
                cwd: repositoryRoot,
                env: expect.objectContaining({ BOARD_DEMO_CAPTURE: "1" }),
                stdio: "inherit",
                windowsHide: true,
            }),
        );
        expect(run.info).toHaveBeenNthCalledWith(
            1,
            "Reset the dedicated basishacks_e2e database for a clean demo run.",
        );
        expect(run.info).toHaveBeenNthCalledWith(
            2,
            "Cleared the isolated demo database after capture.",
        );
        expect(run.exitCode).toBe(0);
    });

    it("accepts an IPv6 loopback database host", async () => {
        const run = await runScript({
            databaseUrl: "postgres://[::1]:5432/basishacks_e2e",
            baseUrl: "http://127.0.0.1:3000",
        });

        expect(run.error).toBeUndefined();
        expect(run.spawnSync).toHaveBeenCalledOnce();
    });

    it("requires the isolated E2E database URL", async () => {
        const run = await runScript({ baseUrl: "http://127.0.0.1:3000" });

        expect(String(run.error)).toContain(
            "Set BASISHACKS_E2E_DATABASE_URL in .env before capturing the board demo.",
        );
        expect(run.spawnSync).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: "malformed database URL",
            databaseUrl: "not a url",
            message: "Set BASISHACKS_E2E_DATABASE_URL in .env to the isolated E2E database.",
        },
        {
            name: "non-PostgreSQL database protocol",
            databaseUrl: "mysql://127.0.0.1/basishacks_e2e",
            message:
                "Board demo capture requires a loopback PostgreSQL database named basishacks_e2e.",
        },
        {
            name: "non-loopback database host",
            databaseUrl: "postgres://db.example.test/basishacks_e2e",
            message:
                "Board demo capture requires a loopback PostgreSQL database named basishacks_e2e.",
        },
        {
            name: "wrong database name",
            databaseUrl: "postgres://127.0.0.1/basishacks_other",
            message:
                "Board demo capture requires a loopback PostgreSQL database named basishacks_e2e.",
        },
    ])("rejects a $name", async ({ databaseUrl, message }) => {
        const run = await runScript({ databaseUrl, baseUrl: "http://127.0.0.1:3000" });

        expect(String(run.error)).toContain(message);
        expect(run.postgresMock).not.toHaveBeenCalled();
        expect(run.spawnSync).not.toHaveBeenCalled();
    });

    it("requires the app origin", async () => {
        const run = await runScript({ databaseUrl: "postgres://127.0.0.1/basishacks_e2e" });

        expect(String(run.error)).toContain(
            "Set PLAYWRIGHT_BASE_URL in .env before capturing the board demo.",
        );
        expect(run.spawnSync).not.toHaveBeenCalled();
    });

    it("rejects a malformed app origin", async () => {
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl: "not a url",
        });

        expect(run.error).toBeInstanceOf(TypeError);
        expect(run.postgresMock).not.toHaveBeenCalled();
    });

    it.each([
        { name: "non-HTTP protocol", baseUrl: "https://127.0.0.1:3000" },
        { name: "non-loopback host", baseUrl: "http://localhost:3000" },
        { name: "missing explicit port", baseUrl: "http://127.0.0.1" },
    ])("rejects an app origin with a $name", async ({ baseUrl }) => {
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl,
        });

        expect(String(run.error)).toContain(
            "PLAYWRIGHT_BASE_URL must be a loopback HTTP origin with an explicit port.",
        );
        expect(run.spawnSync).not.toHaveBeenCalled();
    });

    it("propagates a failed initial database reset without running the capture", async () => {
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl: "http://127.0.0.1:3000",
            failUnsafeAt: 1,
        });

        expect(String(run.error)).toContain("database unavailable");
        expect(run.unsafe).toHaveBeenCalledOnce();
        expect(run.end).toHaveBeenCalledOnce();
        expect(run.spawnSync).not.toHaveBeenCalled();
        expect(run.info).not.toHaveBeenCalled();
    });

    it("still clears the database when the capture process throws", async () => {
        const failure = new Error("playwright crashed");
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl: "http://127.0.0.1:3000",
            spawnError: failure,
        });

        expect(run.error).toBe(failure);
        expect(run.unsafe).toHaveBeenCalledTimes(4);
        expect(run.end).toHaveBeenCalledTimes(2);
        expect(run.info).toHaveBeenCalledTimes(2);
        expect(run.exitCode).toBe(0);
    });

    it("throws a reported capture process error", async () => {
        const failure = new Error("spawn failed");
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl: "http://127.0.0.1:3000",
            spawnResult: { status: null, error: failure },
        });

        expect(run.error).toBe(failure);
        expect(run.unsafe).toHaveBeenCalledTimes(4);
        expect(run.exitCode).toBe(0);
    });

    it.each([
        { name: "numeric failure status", spawnResult: { status: 2, error: undefined }, code: 2 },
        { name: "null status", spawnResult: { status: null, error: undefined }, code: 1 },
        { name: "missing result", spawnResult: undefined, code: 1 },
    ])("exits with the capture $name", async ({ spawnResult, code }) => {
        const run = await runScript({
            databaseUrl: "postgres://127.0.0.1/basishacks_e2e",
            baseUrl: "http://127.0.0.1:3000",
            spawnResult,
        });

        expect(run.error).toBeUndefined();
        expect(run.exitCode).toBe(code);
        expect(run.unsafe).toHaveBeenCalledTimes(4);
    });
});
