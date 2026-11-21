import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type * as schema from "~~/server/database/schema";
import { snapshotDatabaseExport } from "~~/server/utils/database-export";

const judgeId = "judge-identity-must-not-leak";
const inviteSecret = "invite-token-hash-must-not-leak";

const rowsByTable: Record<string, Record<string, unknown>[]> = {
    admin_audit_events: [{ id: 1, action: "team.disband", entity_type: "team", entity_id: "4" }],
    notifications: [{ id: 2, user_id: 3, type: "judge_flag", title: "Conflict", body: "Reason" }],
    judge_assignments: [
        { id: 3, season_id: 1, judge_user_id: judgeId, pathway: "junior", team_id: null },
    ],
    judge_recusals: [{ season_id: 1, judge_user_id: judgeId, team_id: 4, reason: "Conflict" }],
    judge_flags: [
        {
            id: 4,
            season_id: 1,
            team_id: 4,
            judge_user_id: judgeId,
            reason: "Conflict",
            resolved_at: null,
            resolved_by: null,
        },
    ],
    team_invites: [{ id: 5, team_id: 4, email: "invitee@basischina.com", token: inviteSecret }],
};

function mockDatabase() {
    return {
        select: () => ({
            from: (table: unknown) => {
                const name = getTableName(table as typeof schema.teams);
                return {
                    orderBy: () => ({
                        limit: () => ({
                            offset: async () => rowsByTable[name] ?? [],
                        }),
                    }),
                };
            },
        }),
    };
}

async function collectExport() {
    const chunks: string[] = [];
    for await (const chunk of snapshotDatabaseExport(mockDatabase() as never, "json")) {
        chunks.push(chunk);
    }
    return JSON.parse(chunks.join("")) as {
        tables: Record<string, Record<string, unknown>[]>;
    };
}

describe("database export operational readiness tables", () => {
    it("includes the operational tables without judge identities or invite secrets", async () => {
        const parsed = await collectExport();

        for (const table of [
            "admin_audit_events",
            "notifications",
            "judge_assignments",
            "judge_recusals",
            "judge_flags",
            "team_invites",
        ]) {
            expect(parsed.tables).toHaveProperty(table);
        }

        expect(parsed.tables.judge_assignments![0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables.judge_recusals![0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables.judge_flags![0]).not.toHaveProperty("judge_user_id");
        expect(parsed.tables.team_invites![0]).not.toHaveProperty("token");

        const serialized = JSON.stringify(parsed);
        expect(serialized).not.toContain(judgeId);
        expect(serialized).not.toContain(inviteSecret);
    });
});
