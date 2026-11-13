import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, drizzleMock, postgresMock } = vi.hoisted(() => {
    const client = {
        end: vi.fn().mockResolvedValue(undefined),
    };
    const database = { __coveragePostgresDrizzle: true };
    return {
        client,
        drizzleMock: vi.fn(() => database),
        postgresMock: vi.fn(() => client),
    };
});

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));

import {
    closeDatabase,
    createDrizzleDatabase,
    getDatabaseUrl,
    getPostgresClient,
} from "~~/server/database";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("PostgreSQL connection boundary actions", () => {
    beforeEach(async () => {
        await closeDatabase();
        vi.clearAllMocks();
        delete process.env.DATABASE_URL;
    });

    afterEach(async () => {
        await closeDatabase();
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
    });

    it.each(["not a URL", "postgresql://["])("rejects malformed PostgreSQL URL %s", (value) => {
        process.env.DATABASE_URL = value;

        expect(() => getDatabaseUrl()).toThrow(
            "DATABASE_URL must be a valid PostgreSQL connection URL.",
        );
    });

    it("rejects a PostgreSQL URL without a hostname", () => {
        process.env.DATABASE_URL = "postgresql:///basishacks";

        expect(() => getDatabaseUrl()).toThrow(
            "DATABASE_URL must use the postgres:// or postgresql:// protocol.",
        );
    });

    it("does not expose a raw client before database initialization", () => {
        expect(() => getPostgresClient()).toThrow(
            "The PostgreSQL client has not been initialized.",
        );
    });

    it("exposes the shared raw PostgreSQL client after pool initialization", async () => {
        process.env.DATABASE_URL = "postgres://app:secret@localhost:5432/basishacks";

        await createDrizzleDatabase();

        expect(getPostgresClient()).toBe(client);
    });
});
