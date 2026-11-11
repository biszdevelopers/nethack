import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "~~/server/database/schema";
import { snapshotDatabaseExport } from "~~/server/utils/database-export";

const leakedJudgeId = "judge-id-must-not-appear";
const leakedRole = "legacy-judge-role-must-not-appear";
const leakedClientSecret = "oauth-client-secret-must-not-appear";

const rowsByTable: Record<string, Record<string, unknown>[]> = {
    team_scores: [
        {
            team_id: 3,
            judge_user_id: leakedJudgeId,
            scores: { originality: 4 },
            reasoning: "Anonymous comment",
        },
    ],
    judging_drafts: [
        {
            team_id: 3,
            judge_user_id: leakedJudgeId,
            reasoning: "Unpublished draft",
        },
    ],
    sqlite_legacy_data: [
        {
            table_name: "judge_scores_migrate",
            row_key: "13",
            payload: {
                field1: "13",
                field2: "3",
                field3: leakedJudgeId,
                field5: "Anonymous comment",
            },
        },
        {
            table_name: "users",
            row_key: "9",
            payload: { role: leakedRole, age: 17 },
        },
    ],
    oauth2_applications: [
        {
            client_id: "export-client",
            client_secret: leakedClientSecret,
            name: "Export test",
        },
    ],
};

function mockDatabase() {
    const queriedTables: string[] = [];
    const db = {
        select: () => ({
            from: (table: unknown) => {
                const name = getTableName(table as typeof schema.teamScores);
                queriedTables.push(name);
                return {
                    limit: () => ({
                        offset: async () => rowsByTable[name] ?? [],
                    }),
                };
            },
        }),
    };
    return { db, queriedTables };
}

async function collectExport(format: "json" | "csv") {
    const { db, queriedTables } = mockDatabase();
    const chunks: string[] = [];
    for await (const chunk of snapshotDatabaseExport(db as never, format)) chunks.push(chunk);
    return { output: chunks.join(""), queriedTables };
}

describe("admin database export judge privacy", () => {
    it("omits judge IDs, draft correlations, and legacy user mappings from JSON", async () => {
        const { output, queriedTables } = await collectExport("json");
        const parsed = JSON.parse(output) as { tables: Record<string, Record<string, unknown>[]> };

        expect(parsed.tables.team_scores[0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables).not.toHaveProperty("judging_drafts");
        expect(parsed.tables.sqlite_legacy_data[0]!.payload).not.toHaveProperty("field3");
        expect(parsed.tables.sqlite_legacy_data[1]!.payload).not.toHaveProperty("role");
        expect(parsed.tables.oauth2_applications[0]).not.toHaveProperty("client_secret");
        expect(queriedTables).not.toContain("judging_drafts");
        expect(output).not.toContain(leakedJudgeId);
        expect(output).not.toContain(leakedRole);
        expect(output).not.toContain(leakedClientSecret);
    });

    it("applies the same redaction to CSV headers and values", async () => {
        const { output } = await collectExport("csv");

        expect(output).not.toContain("judging_drafts");
        expect(output).not.toContain("judge_user_id");
        expect(output).not.toContain(leakedJudgeId);
        expect(output).not.toContain(leakedRole);
        expect(output).not.toContain("client_secret");
        expect(output).not.toContain(leakedClientSecret);
    });
});
