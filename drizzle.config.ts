import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit reads this file for every command. An unset DATABASE_URL is left
 * empty on purpose: database commands then fail loudly instead of silently
 * connecting to a default local database.
 */
export function createDrizzleConfig(databaseUrl = process.env.DATABASE_URL) {
    return defineConfig({
        schema: "./server/database/schema.ts",
        out: "./drizzle/postgres",
        dialect: "postgresql",
        dbCredentials: { url: databaseUrl?.trim() ?? "" },
    });
}

export default createDrizzleConfig();
