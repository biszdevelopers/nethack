import { createDrizzleConfig } from "../../drizzle.config";

describe("Drizzle PostgreSQL configuration", () => {
    it("uses the local development URL when DATABASE_URL is unset", () => {
        const existingUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            const config = createDrizzleConfig();
            expect(config).toMatchObject({
                schema: "./server/database/schema.ts",
                out: "./drizzle/postgres",
                dialect: "postgresql",
                dbCredentials: { url: "postgres://localhost:5432/basishacks" },
            });
        } finally {
            if (existingUrl === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = existingUrl;
        }
    });

    it("uses a configured deployment URL without replacing PostgreSQL settings", () => {
        const config = createDrizzleConfig("postgresql://db.example.invalid/basishacks");
        expect(config.dbCredentials.url).toBe("postgresql://db.example.invalid/basishacks");
        expect(config.dialect).toBe("postgresql");
        expect(config.schema).toBe("./server/database/schema.ts");
        expect(config.out).toBe("./drizzle/postgres");
    });
});
