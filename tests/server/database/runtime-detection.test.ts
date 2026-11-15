import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, database, drizzleMock, postgresMock } = vi.hoisted(() => {
    const client = {
        begin: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
    };
    const database = { __postgresDrizzle: true };
    return {
        client,
        database,
        drizzleMock: vi.fn(() => database),
        postgresMock: vi.fn(() => client),
    };
});

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));

import {
    closeDatabase,
    createDrizzleDatabase,
    getDatabasePoolMax,
    getDatabaseUrl,
    getDb,
} from "~~/server/database";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPoolMax = process.env.DATABASE_POOL_MAX;

describe("PostgreSQL database configuration", () => {
    beforeEach(async () => {
        await closeDatabase();
        vi.clearAllMocks();
        delete process.env.DATABASE_URL;
        delete process.env.DATABASE_POOL_MAX;
    });

    afterEach(async () => {
        await closeDatabase();
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
        if (originalPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
        else process.env.DATABASE_POOL_MAX = originalPoolMax;
    });

    it("requires a valid PostgreSQL URL and trims surrounding whitespace", () => {
        expect(() => getDatabaseUrl()).toThrow(/DATABASE_URL is required/);

        process.env.DATABASE_URL = "  sqlite:///tmp/basishacks.sqlite  ";
        expect(() => getDatabaseUrl()).toThrow(/postgres/);

        process.env.DATABASE_URL = "  postgresql://app:secret@localhost:5432/basishacks  ";
        expect(getDatabaseUrl()).toBe("postgresql://app:secret@localhost:5432/basishacks");
    });

    it("defaults the pool to ten and accepts only bounded integer overrides", () => {
        expect(getDatabasePoolMax()).toBe(10);

        for (const value of ["2", "10", "64"]) {
            process.env.DATABASE_POOL_MAX = value;
            expect(getDatabasePoolMax()).toBe(Number(value));
        }

        for (const value of ["1", "65", "1.5", "many", ""]) {
            process.env.DATABASE_POOL_MAX = value;
            expect(() => getDatabasePoolMax()).toThrow(/DATABASE_POOL_MAX/);
        }
    });

    it("creates one bounded postgres.js pool and shares its Drizzle instance", async () => {
        process.env.DATABASE_URL = "postgres://app:secret@localhost:5432/basishacks";

        const first = await createDrizzleDatabase();
        const second = await getDb();

        expect(first).toBe(database);
        expect(second).toBe(first);
        expect(postgresMock).toHaveBeenCalledTimes(1);
        expect(postgresMock).toHaveBeenCalledWith(
            process.env.DATABASE_URL,
            expect.objectContaining({
                max: 10,
                idle_timeout: 20,
                connect_timeout: 10,
                prepare: false,
            }),
        );
        expect(drizzleMock).toHaveBeenCalledTimes(1);
        expect(drizzleMock).toHaveBeenCalledWith(
            client,
            expect.objectContaining({ schema: expect.any(Object) }),
        );
    });

    it("closes the PostgreSQL pool during shutdown", async () => {
        process.env.DATABASE_URL = "postgres://app:secret@localhost:5432/basishacks";
        await createDrizzleDatabase();

        await closeDatabase();

        expect(client.end).toHaveBeenCalledWith({ timeout: 5 });
    });
});
