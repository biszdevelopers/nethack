import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    closeDatabase: vi.fn(),
    createDrizzleDatabase: vi.fn(),
    createAndMigrateDatabase: vi.fn(),
    setDatabaseInitialization: vi.fn(),
    collectOrphanProfileAssets: vi.fn(),
    collectOrphanPermalinkAssets: vi.fn(),
}));

vi.mock("~~/server/database", () => ({
    closeDatabase: mocks.closeDatabase,
    createDrizzleDatabase: mocks.createDrizzleDatabase,
    setDatabaseInitialization: mocks.setDatabaseInitialization,
}));
vi.mock("~~/server/database/migrate", () => ({
    createAndMigrateDatabase: mocks.createAndMigrateDatabase,
}));
vi.mock("~~/server/utils/assets", () => ({
    collectOrphanProfileAssets: mocks.collectOrphanProfileAssets,
    collectOrphanPermalinkAssets: mocks.collectOrphanPermalinkAssets,
}));
vi.stubGlobal("defineNitroPlugin", (plugin: (nitroApp: unknown) => Promise<void>) => plugin);

const { default: initDatabase } = await import("~~/server/plugins/init-database");

describe("init-database plugin", () => {
    beforeEach(() => {
        mocks.closeDatabase.mockResolvedValue(undefined);
        mocks.createDrizzleDatabase.mockResolvedValue({});
        mocks.createAndMigrateDatabase.mockResolvedValue(undefined);
        mocks.setDatabaseInitialization.mockReset();
        mocks.collectOrphanProfileAssets.mockResolvedValue({
            entriesVisited: 0,
            scanned: 0,
            deleted: 0,
            referenced: 0,
            tooRecent: 0,
            staleTemporaryFilesDeleted: 0,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        mocks.closeDatabase.mockResolvedValue(undefined);
        mocks.createDrizzleDatabase.mockResolvedValue({});
        mocks.createAndMigrateDatabase.mockResolvedValue(undefined);
        mocks.setDatabaseInitialization.mockReset();
        mocks.collectOrphanProfileAssets.mockReset();
        vi.useRealTimers();
    });

    it("migrates before serving and closes the process-wide pool on shutdown", async () => {
        const hook = vi.fn();
        await initDatabase({ hooks: { hook } });

        expect(mocks.createAndMigrateDatabase).toHaveBeenCalledWith({});
        expect(mocks.setDatabaseInitialization).toHaveBeenCalledOnce();
        expect(hook).toHaveBeenCalledWith("close", expect.any(Function));
        await hook.mock.calls[0]![1]();
        expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
        expect(mocks.collectOrphanProfileAssets).not.toHaveBeenCalled();
    });

    it("publishes readiness before Nitro can dispatch requests while migrations are pending", async () => {
        let finishMigration!: () => void;
        const migration = new Promise<void>((resolve) => {
            finishMigration = resolve;
        });
        mocks.createAndMigrateDatabase.mockReturnValueOnce(migration);
        const hook = vi.fn();
        const pluginPromise = initDatabase({ hooks: { hook } });

        expect(mocks.setDatabaseInitialization).toHaveBeenCalledOnce();
        const readiness = mocks.setDatabaseInitialization.mock.calls[0]![0] as Promise<void>;
        let requestReady = false;
        const request = readiness.then(() => {
            requestReady = true;
        });
        await Promise.resolve();
        expect(mocks.createAndMigrateDatabase).toHaveBeenCalledWith({});
        expect(requestReady).toBe(false);

        finishMigration();
        await Promise.all([pluginPromise, request]);
        expect(requestReady).toBe(true);
        expect(hook).toHaveBeenCalledWith("close", expect.any(Function));
        await hook.mock.calls[0]![1]();
    });

    it("closes PostgreSQL and rejects startup when migration or seeding fails", async () => {
        const failure = new Error("migration failed");
        mocks.createAndMigrateDatabase.mockRejectedValueOnce(failure);

        await expect(initDatabase({ hooks: { hook: vi.fn() } })).rejects.toBe(failure);
        expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
    });

    it("preserves the startup error when pool cleanup also fails", async () => {
        const failure = new Error("migration failed");
        mocks.createAndMigrateDatabase.mockRejectedValueOnce(failure);
        mocks.closeDatabase.mockRejectedValueOnce(new Error("close failed"));
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(initDatabase({ hooks: { hook: vi.fn() } })).rejects.toBe(failure);
        expect(errorLog).toHaveBeenCalledOnce();
        errorLog.mockRestore();
    });

    it("runs bounded profile cleanup after readiness, repeats daily, and clears the timer on close", async () => {
        vi.useFakeTimers();
        const database = {};
        mocks.createDrizzleDatabase.mockResolvedValueOnce(database);
        const hook = vi.fn();
        await initDatabase({ hooks: { hook } });

        expect(mocks.collectOrphanProfileAssets).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60 * 1000);
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledOnce();
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledWith(database, {
            maxScanned: 250,
            maxDeletions: 25,
        });

        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledTimes(2);
        expect(mocks.collectOrphanPermalinkAssets).not.toHaveBeenCalled();

        await hook.mock.calls[0]![1]();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not overlap cleanup runs and logs only sanitized failure details", async () => {
        vi.useFakeTimers();
        let finishFirst!: (value: {
            entriesVisited: number;
            scanned: number;
            deleted: number;
            referenced: number;
            tooRecent: number;
            staleTemporaryFilesDeleted: number;
        }) => void;
        const firstRun = new Promise<{
            entriesVisited: number;
            scanned: number;
            deleted: number;
            referenced: number;
            tooRecent: number;
            staleTemporaryFilesDeleted: number;
        }>((resolve) => {
            finishFirst = resolve;
        });
        mocks.collectOrphanProfileAssets.mockReturnValueOnce(firstRun);
        const hook = vi.fn();
        await initDatabase({ hooks: { hook } });

        await vi.advanceTimersByTimeAsync(60 * 1000);
        await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledOnce();

        finishFirst({
            entriesVisited: 1,
            scanned: 1,
            deleted: 0,
            referenced: 1,
            tooRecent: 0,
            staleTemporaryFilesDeleted: 0,
        });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledTimes(2);

        mocks.collectOrphanProfileAssets.mockRejectedValueOnce(new Error("postgres://secret"));
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(warning).toHaveBeenCalledWith("[Nitro] Profile asset cleanup failed", {
            error: "sanitized",
            scanned: 0,
            deleted: 0,
        });
        expect(JSON.stringify(warning.mock.calls)).not.toContain("postgres://secret");

        await hook.mock.calls[0]![1]();
        warning.mockRestore();
        expect(vi.getTimerCount()).toBe(0);
    });
});
