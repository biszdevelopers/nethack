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

describe("init-database remaining lifecycle coverage", () => {
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
        mocks.collectOrphanPermalinkAssets.mockResolvedValue({
            scanned: 0,
            deleted: 0,
            missing: 0,
            referenced: 0,
            unsafe: 0,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        mocks.closeDatabase.mockReset();
        mocks.createDrizzleDatabase.mockReset();
        mocks.createAndMigrateDatabase.mockReset();
        mocks.setDatabaseInitialization.mockReset();
        mocks.collectOrphanProfileAssets.mockReset();
        mocks.collectOrphanPermalinkAssets.mockReset();
    });

    it("ignores an expired timer after shutdown and waits for an in-flight cleanup", async () => {
        const timerCallbacks: Array<() => void> = [];
        vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
            timerCallbacks.push(callback as () => void);
            return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);

        let finishCleanup!: (result: {
            entriesVisited: number;
            scanned: number;
            deleted: number;
            referenced: number;
            tooRecent: number;
            staleTemporaryFilesDeleted: number;
        }) => void;
        mocks.collectOrphanProfileAssets.mockReturnValueOnce(
            new Promise((resolve) => {
                finishCleanup = resolve;
            }),
        );

        const hook = vi.fn();
        await initDatabase({ hooks: { hook } });
        expect(timerCallbacks).toHaveLength(1);

        timerCallbacks[0]!();
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledOnce();
        expect(mocks.collectOrphanPermalinkAssets).toHaveBeenCalledOnce();

        const close = hook.mock.calls[0]![1] as () => Promise<void>;
        const closePromise = close();
        // A timer already queued by the runtime can overlap the active cleanup.
        timerCallbacks[0]!();
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledOnce();
        expect(mocks.collectOrphanPermalinkAssets).toHaveBeenCalledOnce();

        finishCleanup({
            entriesVisited: 0,
            scanned: 0,
            deleted: 0,
            referenced: 0,
            tooRecent: 0,
            staleTemporaryFilesDeleted: 0,
        });
        await closePromise;
        expect(mocks.closeDatabase).toHaveBeenCalledOnce();

        // Exercise a stale callback after shutdown: it must not start new work.
        timerCallbacks[0]!();
        await Promise.resolve();
        expect(mocks.collectOrphanProfileAssets).toHaveBeenCalledOnce();
        expect(mocks.collectOrphanPermalinkAssets).toHaveBeenCalledOnce();
    });
});
