import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./server/database/schema.ts",
    out: "./drizzle/postgres",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgres://localhost:5432/basishacks",
    },
});
