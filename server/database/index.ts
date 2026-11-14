import postgres, { type Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { installDatabaseMetrics } from "../utils/database-observability";

export type DrizzleDatabase = PostgresJsDatabase<typeof schema>;

let client: Sql | undefined;
let database: DrizzleDatabase | undefined;
let databaseInitialization: Promise<void> = Promise.resolve();

/** Publish the migration promise before Nitro begins accepting database-backed requests. */
export function setDatabaseInitialization(initialization: Promise<void>): void {
    databaseInitialization = initialization;
}

export function getDatabaseUrl(): string {
    const value = process.env.DATABASE_URL?.trim();
    if (!value) {
        throw new Error("DATABASE_URL is required. Configure a PostgreSQL connection URL.");
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }

    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
    }

    return value;
}

export function getDatabasePoolMax(): number {
    const raw = process.env.DATABASE_POOL_MAX ?? "10";
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 2 || value > 64) {
        throw new Error("DATABASE_POOL_MAX must be an integer between 2 and 64.");
    }
    return value;
}

/** Return the process-wide PostgreSQL client and Drizzle instance. */
export async function createDrizzleDatabase(): Promise<DrizzleDatabase> {
    if (database) return database;

    installDatabaseMetrics();
    client = postgres(getDatabaseUrl(), {
        max: getDatabasePoolMax(),
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 60 * 30,
        prepare: false,
    });
    database = drizzle(client, { schema });
    return database;
}

export async function getDb(): Promise<DrizzleDatabase> {
    await databaseInitialization;
    return createDrizzleDatabase();
}

/** Return the raw client for operations that need a pinned PostgreSQL connection. */
export function getPostgresClient(): Sql {
    if (!client) {
        throw new Error("The PostgreSQL client has not been initialized.");
    }
    return client;
}

/** Close the pool during shutdown and clear the singleton for integration tests. */
export async function closeDatabase(): Promise<void> {
    const activeClient = client;
    client = undefined;
    database = undefined;
    if (activeClient) await activeClient.end({ timeout: 5 });
}
