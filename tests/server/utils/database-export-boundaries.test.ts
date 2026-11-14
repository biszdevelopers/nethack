import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "~~/server/database/schema";
import { snapshotDatabaseExport } from "~~/server/utils/database-export";

function createDatabase(rowsByTable: Record<string, Record<string, unknown>[]>) {
    const pageOffsets: Array<{ table: string; limit: number; offset: number }> = [];
    const db = {
        select: () => ({
            from: (table: unknown) => {
                const name = getTableName(table as typeof schema.teams);
                return {
                    limit: (limit: number) => ({
                        offset: async (offset: number) => {
                            pageOffsets.push({ table: name, limit, offset });
                            return (rowsByTable[name] ?? []).slice(offset, offset + limit);
                        },
                    }),
                };
            },
        }),
    };
    return { db, pageOffsets };
}

async function collect(
    format: "json" | "csv",
    rowsByTable: Record<string, Record<string, unknown>[]>,
) {
    const { db, pageOffsets } = createDatabase(rowsByTable);
    const chunks: string[] = [];
    for await (const chunk of snapshotDatabaseExport(db as never, format)) chunks.push(chunk);
    return { output: chunks.join(""), pageOffsets };
}

describe("database export boundary behavior", () => {
    it("exports null and undefined CSV fields as empty cells", async () => {
        const { output } = await collect("csv", {
            teams: [
                {
                    id: 1,
                    nullable: null,
                    absent: undefined,
                    boolean: false,
                    amount: 0,
                    quoted: 'a,"b"',
                },
            ],
        });

        expect(output).toContain("id,nullable,absent,boolean,amount,quoted\r\n");
        expect(output).toContain('1,,,false,0,"a,""b"""\r\n');
    });

    it("leaves null, primitive, and array legacy payloads unchanged", async () => {
        const { output } = await collect("json", {
            sqlite_legacy_data: [
                { table_name: "users", row_key: "1", payload: null },
                { table_name: "users", row_key: "2", payload: "legacy scalar" },
                { table_name: "users", row_key: "3", payload: ["legacy", "array"] },
            ],
        });

        const parsed = JSON.parse(output) as {
            tables: { sqlite_legacy_data: Array<{ payload: unknown }> };
        };
        expect(parsed.tables.sqlite_legacy_data.map((row) => row.payload)).toEqual([
            null,
            "legacy scalar",
            ["legacy", "array"],
        ]);
    });

    it("continues to the next CSV page when a full page is followed by more rows", async () => {
        const teams = Array.from({ length: 251 }, (_, index) => ({
            id: index + 1,
            name: `Team ${index + 1}`,
        }));
        const { output, pageOffsets } = await collect("csv", { teams });

        expect(pageOffsets.filter(({ table }) => table === "teams")).toEqual([
            { table: "teams", limit: 250, offset: 0 },
            { table: "teams", limit: 250, offset: 250 },
        ]);
        expect(output.match(/id,name\r\n/g)).toHaveLength(1);
        expect(output).toContain("250,Team 250\r\n");
        expect(output).toContain("251,Team 251\r\n");
    });
});
