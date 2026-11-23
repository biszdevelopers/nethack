import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type * as schema from "~~/server/database/schema";
import type { LiveOverrides } from "~~/shared/schemas";
import { snapshotDatabaseExport } from "~~/server/utils/database-export";

const leakedJudgeId = "judge-id-must-not-appear";
const leakedRole = "legacy-judge-role-must-not-appear";
const leakedClientSecret = "oauth-client-secret-must-not-appear";

const rowsByTable: Record<string, Record<string, unknown>[]> = {
    teams: [
        {
            id: 4,
            name: "Formula test",
            project_description: '\n=HYPERLINK("https://example.invalid","open")',
        },
        { id: 5, name: "Control test", project_description: "\tplain text" },
    ],
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
    judge_flags: [
        {
            id: 6,
            judge_user_id: leakedJudgeId,
            resolved_by: leakedJudgeId,
            reason: "Conflict",
        },
    ],
    admin_audit_events: [
        {
            id: 7,
            actor_user_id: leakedJudgeId,
            action: "team.status",
            before: {
                judge_user_id: leakedJudgeId,
                status: "active",
                tags: [{ judge_user_id: leakedJudgeId, label: "x" }],
            },
            after: { resolved_by: leakedJudgeId, status: "withdrawn" },
        },
        {
            id: 8,
            actor_user_id: leakedJudgeId,
            action: "score.delete",
            entity_type: "team_score",
            entity_id: `3:${leakedJudgeId}`,
        },
    ],
};

function mockDatabase() {
    const queriedTables: string[] = [];
    const orderByCalls: Record<string, unknown[]> = {};
    const db = {
        select: () => ({
            from: (table: unknown) => {
                const name = getTableName(table as typeof schema.teamScores);
                queriedTables.push(name);
                return {
                    orderBy: (...order: unknown[]) => {
                        orderByCalls[name] = order;
                        return {
                            limit: () => ({
                                offset: async () => rowsByTable[name] ?? [],
                            }),
                        };
                    },
                };
            },
        }),
    };
    return { db, queriedTables, orderByCalls };
}

async function collectExport(format: "json" | "csv", liveOverrides: LiveOverrides = {}) {
    const { db, queriedTables, orderByCalls } = mockDatabase();
    const chunks: string[] = [];
    for await (const chunk of snapshotDatabaseExport(db as never, format, liveOverrides)) {
        chunks.push(chunk);
    }
    return { output: chunks.join(""), queriedTables, orderByCalls };
}

describe("admin database export judge privacy", () => {
    it("orders every paginated table by a stable key", async () => {
        const { orderByCalls } = await collectExport("json");

        expect(orderByCalls.users?.length).toBe(1);
        expect(orderByCalls.peer_voting_scores?.length).toBe(1);
    });

    it("omits judge IDs, draft correlations, and legacy user mappings from JSON", async () => {
        const { output, queriedTables } = await collectExport("json");
        const parsed = JSON.parse(output) as { tables: Record<string, Record<string, unknown>[]> };

        expect(parsed.tables.team_scores[0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables).not.toHaveProperty("judging_drafts");
        expect(parsed.tables.sqlite_legacy_data[0]!.payload).not.toHaveProperty("field3");
        expect(parsed.tables.sqlite_legacy_data[1]!.payload).not.toHaveProperty("role");
        expect(parsed.tables.oauth2_applications[0]).not.toHaveProperty("client_secret");
        expect(parsed.tables.judge_flags[0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables.judge_flags[0]).not.toHaveProperty("resolved_by");
        expect(parsed.tables.admin_audit_events[0]).not.toHaveProperty("actor_user_id");
        expect(parsed.tables.admin_audit_events[0]!.before).not.toHaveProperty("judge_user_id");
        expect(parsed.tables.admin_audit_events[0]!.after).not.toHaveProperty("resolved_by");
        expect(parsed.tables.admin_audit_events[1]).not.toHaveProperty("entity_id");
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

    it("keeps CSV rows aligned when an anonymized row drops a key", async () => {
        const { output } = await collectExport("csv");
        const section = output
            .split("--- admin_audit_events ---\r\n")[1]!
            .split("\r\n--- ")[0]!
            .trim();
        const csvWidth = (line: string) => {
            let width = 1;
            let quoted = false;
            for (let index = 0; index < line.length; index += 1) {
                const character = line[index];
                if (character === '"') {
                    if (quoted && line[index + 1] === '"') index += 1;
                    else quoted = !quoted;
                } else if (character === "," && !quoted) {
                    width += 1;
                }
            }
            return width;
        };
        const widths = section.split("\r\n").map(csvWidth);

        expect(new Set(widths).size).toBe(1);
    });

    it("neutralizes formulas preceded by line breaks before CSV quoting", async () => {
        const { output } = await collectExport("csv");

        expect(output).toContain("\"'\n=HYPERLINK(");
        expect(output).toContain("'\tplain text");
    });

    it("exports the live manifest instead of stale hackathon rows in YAML mode", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        try {
            const { output, queriedTables } = await collectExport("json");
            const parsed = JSON.parse(output) as {
                tables: Record<string, Record<string, unknown>[]>;
            };

            expect(parsed.tables.hackathon[0]).toMatchObject({ id: 1, status: "voting" });
            expect(queriedTables).not.toContain("hackathon");
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("applies portal overrides to the exported live configuration", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        try {
            const { output, queriedTables } = await collectExport("json", {
                status: "finished",
                judging_open: 0,
            });
            const parsed = JSON.parse(output) as {
                tables: Record<string, Record<string, unknown>[]>;
            };

            expect(parsed.tables.hackathon[0]).toMatchObject({
                id: 1,
                status: "finished",
                judging_open: 0,
            });
            expect(queriedTables).not.toContain("hackathon");
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
