import { afterEach, describe, expect, it } from "vitest";
import { getDatabasePoolMax, getDatabaseUrl } from "~~/server/database";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPoolMax = process.env.DATABASE_POOL_MAX;

afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = originalPoolMax;
});

describe("PostgreSQL environment validation", () => {
    it("requires a database URL", () => {
        delete process.env.DATABASE_URL;

        expect(() => getDatabaseUrl()).toThrow(
            "DATABASE_URL is required. Configure a PostgreSQL connection URL.",
        );
        process.env.DATABASE_URL = "   ";
        expect(() => getDatabaseUrl()).toThrow("DATABASE_URL is required");
    });

    it("accepts both PostgreSQL protocols", () => {
        process.env.DATABASE_URL = "postgres://localhost/app";
        expect(getDatabaseUrl()).toBe("postgres://localhost/app");
        process.env.DATABASE_URL = "postgresql://localhost/app";
        expect(getDatabaseUrl()).toBe("postgresql://localhost/app");
    });

    it("defaults the pool size to ten", () => {
        delete process.env.DATABASE_POOL_MAX;
        expect(getDatabasePoolMax()).toBe(10);
    });

    it.each(["2", "64"])("accepts the pool bound %s", (value) => {
        process.env.DATABASE_POOL_MAX = value;
        expect(getDatabasePoolMax()).toBe(Number(value));
    });

    it.each(["1", "65", "2.5", "abc", ""])("rejects the pool size %j", (value) => {
        process.env.DATABASE_POOL_MAX = value;

        expect(() => getDatabasePoolMax()).toThrow(
            "DATABASE_POOL_MAX must be an integer between 2 and 64.",
        );
    });
});
