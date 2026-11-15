import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
    createDrizzleDatabase: vi.fn(async () => ({ db: true })),
    closeDatabase: vi.fn(async () => undefined),
    createAndMigrateDatabase: vi.fn(async () => undefined),
}));

vi.mock("~~/server/database", () => ({
    createDrizzleDatabase: dependencies.createDrizzleDatabase,
    closeDatabase: dependencies.closeDatabase,
}));
vi.mock("~~/server/database/migrate", () => ({
    createAndMigrateDatabase: dependencies.createAndMigrateDatabase,
}));

describe("PostgreSQL migration CLI entry point", () => {
    beforeEach(() => {
        dependencies.createDrizzleDatabase.mockReset().mockResolvedValue({ db: true });
        dependencies.closeDatabase.mockReset().mockResolvedValue(undefined);
        dependencies.createAndMigrateDatabase.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    const run = async () => {
        vi.resetModules();
        await import("../../scripts/db-migrate.ts");
    };

    it("migrates and closes the shared database pool", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        dependencies.createDrizzleDatabase.mockResolvedValue({ db: true } as any);
        dependencies.createAndMigrateDatabase.mockResolvedValue(undefined);

        await run();

        expect(dependencies.createAndMigrateDatabase).toHaveBeenCalledWith({ db: true });
        expect(info).toHaveBeenCalledWith("PostgreSQL migrations and seeds are up to date.");
        expect(dependencies.closeDatabase).toHaveBeenCalledOnce();
        expect(process.exitCode).not.toBe(1);
    });

    it("reports a migration exception and preserves its safe message", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        dependencies.createDrizzleDatabase.mockResolvedValue({ db: true } as any);
        dependencies.createAndMigrateDatabase.mockRejectedValue(new Error("migration failed"));

        await run();

        expect(errorLog).toHaveBeenCalledWith("PostgreSQL migration failed.");
        expect(errorLog).toHaveBeenCalledWith("migration failed");
        expect(process.exitCode).toBe(1);
        expect(dependencies.closeDatabase).toHaveBeenCalledOnce();
    });

    it("uses a generic message for non-Error migration failures", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        dependencies.createDrizzleDatabase.mockRejectedValue("non-error rejection");

        await run();

        expect(errorLog).toHaveBeenCalledWith("Unknown migration error");
        expect(process.exitCode).toBe(1);
        expect(dependencies.closeDatabase).toHaveBeenCalledOnce();
    });
});
