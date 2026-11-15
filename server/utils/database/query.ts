/** Run a PostgreSQL Drizzle query and return its first row, if present. */
export async function firstRow<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
    const rows = await query;
    return rows[0];
}

/** Run a `RETURNING` mutation and report how many rows it changed. */
export async function changedRows<T>(query: PromiseLike<T[]>): Promise<number> {
    return (await query).length;
}
