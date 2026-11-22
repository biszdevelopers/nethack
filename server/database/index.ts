import postgres, { type Sql } from "postgres";
import { tracingChannel } from "node:diagnostics_channel";
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

const SLOW_QUERY_LOG_LIMIT = 20;
const SLOW_QUERY_LOG_WINDOW_MS = 60_000;
let slowQueryLoggingInstalled = false;

/**
 * Bounded slow-query logging for DATABASE_METRICS=1. Emits identifiers only
 * (timing, never SQL text) and caps log volume per minute.
 */
function installSlowQueryLog(): void {
    if (slowQueryLoggingInstalled || process.env.DATABASE_METRICS !== "1") return;
    slowQueryLoggingInstalled = true;

    const configured = Number(process.env.DATABASE_SLOW_QUERY_MS ?? 250);
    const threshold = Number.isFinite(configured) && configured > 0 ? configured : 250;
    let windowStart = Date.now();
    let logged = 0;

    tracingChannel("postgres:query").subscribe({
        asyncEnd(context: object & { error?: unknown; result?: unknown }) {
            const { sent, complete } = context as { sent?: number; complete?: number };
            if (typeof sent !== "number" || typeof complete !== "number") return;
            const duration = complete - sent;
            if (duration < threshold) return;

            const now = Date.now();
            if (now - windowStart >= SLOW_QUERY_LOG_WINDOW_MS) {
                windowStart = now;
                logged = 0;
            }
            if (logged >= SLOW_QUERY_LOG_LIMIT) return;
            logged += 1;
            console.warn(
                JSON.stringify({
                    event: "postgres_slow_query",
                    duration_ms: Math.round(duration),
                    threshold_ms: threshold,
                    timestamp: new Date(now).toISOString(),
                }),
            );
        },
    });
}

/** Return the process-wide PostgreSQL client and Drizzle instance. */
export async function createDrizzleDatabase(): Promise<DrizzleDatabase> {
    if (database) return database;

    installDatabaseMetrics();
    installSlowQueryLog();
    client = postgres(getDatabaseUrl(), {
        max: getDatabasePoolMax(),
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 60 * 30,
        prepare: false,
        connection: {
            statement_timeout: 15_000,
            idle_in_transaction_session_timeout: 30_000,
        },
    });
    database = drizzle(client, { schema });
    return database;
}

/**
 * Dedicated migrator connection. DDL batches must not inherit the request
 * pool's interactive statement timeout, or a slow upgrade rolls back and the
 * process exits on every restart. Two connections are required: one holds the
 * advisory lock while Drizzle applies migrations on the other.
 */
export async function createMigrationDatabase(): Promise<{
    database: DrizzleDatabase;
    client: Sql;
}> {
    const migrationClient = postgres(getDatabaseUrl(), {
        max: 2,
        idle_timeout: 5,
        connect_timeout: 10,
        prepare: false,
        connection: {
            statement_timeout: 0,
            idle_in_transaction_session_timeout: 0,
        },
    });
    return {
        database: drizzle(migrationClient, { schema }),
        client: migrationClient,
    };
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
