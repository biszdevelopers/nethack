import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "~~/server/database/schema";
import { createTestDatabase } from "~~/tests/setup";

function createErrorMock(err: {
    status?: number;
    statusCode?: number;
    message?: string;
    statusMessage?: string;
}) {
    const statusCode = err.statusCode ?? err.status ?? 500;
    const message = err.statusMessage ?? err.message ?? "Error";
    const error = new Error(message) as any;
    error.statusCode = statusCode;
    error.statusMessage = message;
    throw error;
}

export async function createMockEvent() {
    const db = await createTestDatabase();

    async function createDrizzle(
        raw: any,
    ): Promise<BaseSQLiteDatabase<"sync", any, typeof schema>> {
        if (typeof Bun !== "undefined") {
            const { drizzle } = await import("drizzle-orm/bun-sqlite");
            return drizzle(raw, { schema }) as any;
        }
        const { drizzle } = await import("drizzle-orm/better-sqlite3");
        return drizzle(raw, { schema }) as any;
    }

    const drizzleDb = await createDrizzle(db.getRawDb());

    // Stub Nitro auto-imports used by database helpers
    vi.stubGlobal("createError", createErrorMock);
    vi.stubGlobal("getActiveSeason", async () => {
        const row = drizzleDb
            .select()
            .from(schema.seasons)
            .where(eq(schema.seasons.is_active, 1))
            .get();
        return row ?? null;
    });
    vi.stubGlobal("getHackathon", async () => {
        const row = drizzleDb.select().from(schema.hackathon).get();
        return row ?? null;
    });

    // Expose the raw SQLite wrapper methods (prepare/exec/batch) on the same
    // object as the Drizzle ORM so tests can use event.context.drizzle for both
    // ORM queries and raw SQL setup/assertions.
    let combined: any;
    combined = new Proxy(drizzleDb, {
        get(target, prop, receiver) {
            if (prop === "transaction") {
                return async (callback: (tx: unknown) => unknown) => {
                    db.exec("BEGIN");
                    try {
                        const result = await callback(combined);
                        db.exec("COMMIT");
                        return result;
                    } catch (error) {
                        db.exec("ROLLBACK");
                        throw error;
                    }
                };
            }
            if (prop in db && typeof (db as any)[prop] === "function") {
                return (db as any)[prop].bind(db);
            }
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    }) as any;

    return {
        context: { drizzle: combined },
    } as any;
}
