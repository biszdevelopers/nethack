import { defineConfig } from "drizzle-kit";

export function createDrizzleConfig(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl?.trim()) {
        throw new Error(
            "DATABASE_URL is required so Drizzle Kit never targets an unintended database.",
        );
    }

    return defineConfig({
        schema: "./server/database/schema.ts",
        out: "./drizzle/postgres",
        dialect: "postgresql",
        dbCredentials: { url: databaseUrl },
    });
}

export default async () => createDrizzleConfig();
