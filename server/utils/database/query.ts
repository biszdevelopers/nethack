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

/**
 * Detect a unique-constraint violation from either the driver error or the
 * `DrizzleQueryError` that wraps it in `.cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
    const codes = databaseErrorCodes(error);
    return codes.includes("23505") || codes.includes("SQLITE_CONSTRAINT_UNIQUE");
}

/** Collect driver error codes from an error and its wrapped causes. */
export function databaseErrorCodes(error: unknown): string[] {
    const codes: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 3 && current; depth += 1) {
        const code = (current as { code?: string }).code;
        if (typeof code === "string") codes.push(code);
        current = (current as { cause?: unknown }).cause;
    }
    return codes;
}
