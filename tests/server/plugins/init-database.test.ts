import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    closeDatabase: vi.fn(),
    createDrizzleDatabase: vi.fn(),
    createAndMigrateDatabase: vi.fn(),
}));

vi.mock("~~/server/database", () => ({
    closeDatabase: mocks.closeDatabase,
    createDrizzleDatabase: mocks.createDrizzleDatabase,
}));
vi.mock("~~/server/database/migrate", () => ({
    createAndMigrateDatabase: mocks.createAndMigrateDatabase,
}));
vi.stubGlobal("defineNitroPlugin", (plugin: (nitroApp: unknown) => Promise<void>) => plugin);

const { default: initDatabase } = await import("~~/server/plugins/init-database");

describe("init-database plugin", () => {
    beforeEach(() => {
        mocks.closeDatabase.mockResolvedValue(undefined);
        mocks.createDrizzleDatabase.mockResolvedValue({});
        mocks.createAndMigrateDatabase.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
        mocks.closeDatabase.mockResolvedValue(undefined);
        mocks.createDrizzleDatabase.mockResolvedValue({});
        mocks.createAndMigrateDatabase.mockResolvedValue(undefined);
    });

    it("migrates before serving and closes the process-wide pool on shutdown", async () => {
        const hook = vi.fn();
        await initDatabase({ hooks: { hook } });

        expect(mocks.createAndMigrateDatabase).toHaveBeenCalledWith({});
        expect(hook).toHaveBeenCalledWith("close", expect.any(Function));
        await hook.mock.calls[0]![1]();
        expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
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
});
