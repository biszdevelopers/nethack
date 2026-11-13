import { defineConfig } from "drizzle-kit";

export function createDrizzleConfig(databaseUrl = process.env.DATABASE_URL) {
    return defineConfig({
        schema: "./server/database/schema.ts",
        out: "./drizzle/postgres",
        dialect: "postgresql",
        dbCredentials: {
            url: databaseUrl ?? "postgres://localhost:5432/basishacks",
        },
    });
}

export default createDrizzleConfig();
