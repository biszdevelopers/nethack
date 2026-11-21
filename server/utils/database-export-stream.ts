import { once } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import type { DrizzleDatabase } from "~~/server/database";
import type { LiveOverrides } from "~~/shared/schemas";
import { snapshotDatabaseExport } from "./database-export";

/**
 * Bridge the async export generator into a real Node stream inside the
 * repeatable-read transaction. Chunks are written lazily with backpressure so
 * a large export never accumulates in memory; the transaction stays open until
 * the consumer finishes the stream.
 */
export function streamDatabaseExport(
    db: Pick<DrizzleDatabase, "transaction">,
    format: "json" | "csv",
    liveOverrides: LiveOverrides = {},
    source: typeof snapshotDatabaseExport = snapshotDatabaseExport,
): Readable {
    const stream = new PassThrough({ highWaterMark: 16 * 1024 });

    void (async () => {
        try {
            await db.transaction(
                async (tx) => {
                    for await (const chunk of source(tx, format, liveOverrides)) {
                        if (stream.destroyed) return;
                        if (!stream.write(chunk)) {
                            await Promise.race([once(stream, "drain"), once(stream, "close")]);
                        }
                    }
                },
                { isolationLevel: "repeatable read", accessMode: "read only" },
            );
            stream.end();
        } catch (error) {
            stream.destroy(error instanceof Error ? error : new Error("export failed"));
        }
    })();

    return stream;
}
