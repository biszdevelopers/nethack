import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrizzleDatabase } from "~~/server/database";
import type { Sql } from "postgres";

const mocks = vi.hoisted(() => ({
    migrate: vi.fn(),
    getPostgresClient: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("~~/server/database/index", () => ({ getPostgresClient: mocks.getPostgresClient }));

import { createAndMigrateDatabase, migrateDatabase } from "~~/server/database/migrate";

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
        mocks.getPostgresClient.mockReset();
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

    it("runs migrations, event seeding, and default season seeding before startup", async () => {
        const events: string[] = [];
        const connection = vi.fn(async () => {
            events.push("advisory-lock");
        });
        const client = {
            begin: vi.fn(async (callback: (sql: typeof connection) => Promise<unknown>) => {
                events.push("begin-migration-transaction");
                return callback(connection);
            }),
        } as unknown as Sql;
        mocks.getPostgresClient.mockReturnValue(client);
        mocks.migrate.mockImplementation(async () => {
            events.push("migrations");
        });

        const selectResults: unknown[][] = [[], [{ id: 10, name: "BIBS-C Default" }], []];
        let selectIndex = 0;
        const makeInsert = (table: string) => {
            const builder = {
                values: vi.fn(() => builder),
                onConflictDoNothing: vi.fn(() => builder),
                returning: vi.fn(async () => []),
                then: (
                    resolve: (value: unknown) => unknown,
                    reject: (error: unknown) => unknown,
                ) => {
                    events.push(`seed:${table}`);
                    return Promise.resolve([]).then(resolve, reject);
                },
            };
            return builder;
        };
        const transaction = {
            select: () => {
                const builder = {
                    from: () => builder,
                    where: () => builder,
                    orderBy: () => builder,
                    limit: () => builder,
                    then: (
                        resolve: (value: unknown) => unknown,
                        reject: (error: unknown) => unknown,
                    ) => Promise.resolve(selectResults[selectIndex++] ?? []).then(resolve, reject),
                };
                return builder;
            },
            insert: (table: unknown) => makeInsert(table === undefined ? "unknown" : "seeded"),
        };
        const database = {
            insert: () => makeInsert("hackathon"),
            transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => {
                events.push("begin-default-seed-transaction");
                return callback(transaction);
            },
        } as unknown as DrizzleDatabase;

        await createAndMigrateDatabase(database);

        expect(events).toEqual([
            "begin-migration-transaction",
            "advisory-lock",
            "migrations",
            "seed:hackathon",
            "begin-default-seed-transaction",
            "seed:seeded",
        ]);
        expect(mocks.getPostgresClient).toHaveBeenCalledOnce();
    });
});
