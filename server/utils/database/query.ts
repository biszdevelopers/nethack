/** Run a PostgreSQL Drizzle query and return its first row, if present. */
export async function firstRow<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
    const rows = await query;
    return rows[0];
}

/** Run a `RETURNING` mutation and report how many rows it changed. */
export async function changedRows<T>(query: PromiseLike<T[]>): Promise<number> {
    return (await query).length;
}

/**
 * Add `FOR UPDATE` on PostgreSQL. SQLite Drizzle queries have no `.for()`, so
 * the helper is a no-op there and the in-memory fixtures keep working.
 */
export function lockForUpdateIfSupported<T>(query: T): T {
    const lockable = query as T & { for?: (lock: "update") => T };
    return typeof lockable.for === "function" ? lockable.for("update") : query;
}

/** True when the query builder supports PostgreSQL row locks. */
export function supportsRowLocks(query: unknown): boolean {
    return typeof (query as { for?: unknown } | null)?.for === "function";
}
