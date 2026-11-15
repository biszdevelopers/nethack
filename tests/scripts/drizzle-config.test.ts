import { describe, expect, it } from "vitest";
import drizzleConfig, { createDrizzleConfig } from "../../drizzle.config";

describe("Drizzle PostgreSQL configuration", () => {
    it("exposes the config object Drizzle Kit reads from the module", () => {
        expect(drizzleConfig.dialect).toBe("postgresql");
        expect(drizzleConfig.schema).toBe("./server/database/schema.ts");
    });

    it("never substitutes an implicit local database when DATABASE_URL is unset", () => {
        const existingUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            expect(createDrizzleConfig().dbCredentials.url).toBe("");
            expect(createDrizzleConfig("   ").dbCredentials.url).toBe("");
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
