import { describe, expect, it } from "vitest";
import { streamDatabaseExport } from "~~/server/utils/database-export-stream";

function fakeTransaction(seenOptions: unknown[]) {
    return {
        async transaction(callback: (tx: unknown) => Promise<void>, options: unknown) {
            seenOptions.push(options);
            await callback({});
        },
    };
}

describe("streamDatabaseExport", () => {
    it("runs inside one repeatable-read read-only transaction", async () => {
        const options: unknown[] = [];
        const db = fakeTransaction(options);
        const source = async function* () {
            yield "hello";
        };

        const stream = streamDatabaseExport(db as never, "json", {}, source as never);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));

        expect(Buffer.concat(chunks).toString()).toBe("hello");
        expect(options).toEqual([{ isolationLevel: "repeatable read", accessMode: "read only" }]);
    });

    it("does not accumulate every row in memory", async () => {
        let produced = 0;
        const rows = 100_000;
        const source = async function* () {
            for (let index = 0; index < rows; index += 1) {
                produced += 1;
                yield `${"x".repeat(512)}\n`;
            }
        };

        const stream = streamDatabaseExport(
            fakeTransaction([]) as never,
            "csv",
            {},
            source as never,
        );
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        expect(first.done).toBe(false);
        // Backpressure bounds the producer to roughly the PassThrough high-water
        // mark, nowhere near the full 100k-row export.
        expect(produced).toBeLessThan(1_000);

        stream.destroy();
        await new Promise((resolve) => stream.once("close", resolve));
        expect(produced).toBeLessThan(rows);
    });

    it("destroys the stream with the export failure", async () => {
        const source = async function* () {
            yield "partial";
            throw new Error("query failed");
        };
        const stream = streamDatabaseExport(
            fakeTransaction([]) as never,
            "json",
            {},
            source as never,
        );

        await expect(
            (async () => {
                for await (const _chunk of stream) {
                    // Drain until the stream errors.
                }
            })(),
        ).rejects.toThrow("query failed");
    });
});
