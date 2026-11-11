import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrizzleDatabase } from "~~/server/database";
import type { Sql } from "postgres";

const mocks = vi.hoisted(() => ({
    migrate: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: mocks.migrate }));

import { migrateDatabase } from "~~/server/database/migrate";

type SqlCall = {
    strings: TemplateStringsArray;
    values: unknown[];
};

function createDatabase(events: string[] = []) {
    const calls: SqlCall[] = [];
    const connection = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ strings, values });
        events.push("lock");
        return [];
    });
    const begin = vi.fn(async (callback: (sql: typeof connection) => Promise<unknown>) =>
        callback(connection),
    );
    const database = {} as DrizzleDatabase;
    const client = { begin } as unknown as Sql;
    return { database, client, calls, connection, begin };
}

describe("PostgreSQL migrations", () => {
    beforeEach(() => {
        mocks.migrate.mockReset();
        mocks.migrate.mockResolvedValue(undefined);
    });

    it("holds a PostgreSQL advisory transaction lock while Drizzle migrates", async () => {
        const events: string[] = [];
        const { database, client, calls, connection, begin } = createDatabase(events);
        mocks.migrate.mockImplementation(async () => {
            events.push("migrate");
        });
        const migrationsFolder = "C:/release/drizzle/postgres";

        await migrateDatabase(database, migrationsFolder, client);

        expect(begin).toHaveBeenCalledTimes(1);
        expect(connection).toHaveBeenCalledTimes(1);
        expect(calls[0]?.strings.join("?")).toContain("pg_advisory_xact_lock(?)");
        expect(calls[0]?.values).toEqual([BigInt("75110114284009")]);
        expect(events).toEqual(["lock", "migrate"]);
        expect(mocks.migrate).toHaveBeenCalledWith(database, { migrationsFolder });
    });

    it("uses the PostgreSQL migrations directory by default", async () => {
        const { database, client } = createDatabase();

        await migrateDatabase(database, undefined, client);

        expect(mocks.migrate).toHaveBeenCalledWith(database, {
            migrationsFolder: expect.stringMatching(/[\\/]drizzle[\\/]postgres$/),
        });
    });

    it("propagates migration failures so startup cannot continue on a partial schema", async () => {
        const { database, client } = createDatabase();
        const failure = new Error("migration failed");
        mocks.migrate.mockRejectedValueOnce(failure);

        await expect(migrateDatabase(database, undefined, client)).rejects.toBe(failure);
    });
});
