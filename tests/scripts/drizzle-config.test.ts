import { vi } from "vitest";
import { createDrizzleConfig } from "../../drizzle.config";

describe("Drizzle PostgreSQL configuration", () => {
    it("exposes the CLI factory used by Drizzle Kit", async () => {
        vi.stubEnv("DATABASE_URL", "postgresql://fixture@localhost/basishacks");
        const module = await import("../../drizzle.config");
        const config = await module.default();

        expect(config.dialect).toBe("postgresql");
        expect(config.schema).toBe("./server/database/schema.ts");
        vi.unstubAllEnvs();
    });
    it("refuses to target an implicit local database when DATABASE_URL is unset", () => {
        const existingUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            expect(() => createDrizzleConfig()).toThrow(
                "DATABASE_URL is required so Drizzle Kit never targets an unintended database.",
            );
            expect(() => createDrizzleConfig("")).toThrow("DATABASE_URL is required");
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
