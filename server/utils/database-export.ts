import * as schema from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { asc, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { LiveOverrides } from "~~/shared/schemas";
import { csvCell } from "./csv";
import { hackathonUsesYaml, readHackathonConfig } from "./hackathon-config";

const PAGE_SIZE = 250;

const exportTables = [
    ["hackathon", schema.hackathon],
    ["seasons", schema.seasons],
    ["teams", schema.teams],
    ["users", schema.users],
    ["team_scores", schema.teamScores],
    ["ballots", schema.ballots],
    ["ballot_scores", schema.ballotScores],
    ["oauth2_applications", schema.oauth2Applications],
    ["peer_voting_scores", schema.peerVotingScores],
    ["team_awards", schema.teamAwards],
    ["awards", schema.awards],
    ["asset_objects", schema.assetObjects],
    ["asset_references", schema.assetReferences],
    ["user_past_teams", schema.userPastTeams],
    ["rubric_templates", schema.rubricTemplates],
    ["rubric_versions", schema.rubricVersions],
    ["admin_audit_events", schema.adminAuditEvents],
    ["notifications", schema.notifications],
    ["judge_assignments", schema.judgeAssignments],
    ["judge_recusals", schema.judgeRecusals],
    ["judge_flags", schema.judgeFlags],
    ["team_invites", schema.teamInvites],
    ["sc_votes", schema.scVotes],
    ["sqlite_legacy_data", schema.sqliteLegacyData],
] as const;

const STAFF_REFERENCE_KEYS = new Set(["actor_user_id", "resolved_by", "judge_user_id"]);

/** Remove staff account references from nested audit payloads. */
function stripStaffReferences(value: unknown, depth = 0): unknown {
    if (depth > 5 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => stripStaffReferences(item, depth + 1));
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (STAFF_REFERENCE_KEYS.has(key)) continue;
        result[key] = stripStaffReferences(item, depth + 1);
    }
    return result;
}

function anonymizeExportRow(name: string, row: Record<string, unknown>) {
    if (name === "oauth2_applications") {
        const safeApplication = { ...row };
        delete safeApplication.client_secret;
        return safeApplication;
    }

    if (name === "team_scores") {
        const anonymousScore = { ...row };
        delete anonymousScore.judge_user_id;
        return anonymousScore;
    }

    // Staff identity links are withheld from exports; the operational record
    // (track assignment, recusal, flag, resolution) remains exportable.
    if (name === "judge_assignments" || name === "judge_recusals") {
        const anonymousRow = { ...row };
        delete anonymousRow.judge_user_id;
        return anonymousRow;
    }

    if (name === "judge_flags") {
        const anonymousRow = { ...row };
        delete anonymousRow.judge_user_id;
        delete anonymousRow.resolved_by;
        return anonymousRow;
    }

    if (name === "admin_audit_events") {
        const anonymousRow = { ...row };
        delete anonymousRow.actor_user_id;
        // A voided evaluation's entity id embeds the judge account id.
        if (anonymousRow.entity_type === "team_score") delete anonymousRow.entity_id;
        // Judge-role changes name the staff account in entity_id.
        if (anonymousRow.entity_type === "user" && String(anonymousRow.action).includes("judge")) {
            delete anonymousRow.entity_id;
        }
        if (anonymousRow.before) {
            anonymousRow.before = stripStaffReferences(anonymousRow.before);
        }
        if (anonymousRow.after) {
            anonymousRow.after = stripStaffReferences(anonymousRow.after);
        }
        return anonymousRow;
    }

    // Invitation bearer secrets must never leave the database.
    if (name === "team_invites") {
        const safeInvite = { ...row };
        delete safeInvite.token;
        return safeInvite;
    }

    if (name === "sqlite_legacy_data") {
        const payload = row.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return row;

        const legacyPayload = { ...(payload as Record<string, unknown>) };
        if (row.table_name === "judge_scores_migrate") delete legacyPayload.field3;
        if (row.table_name === "users") delete legacyPayload.role;
        return { ...row, payload: legacyPayload };
    }

    return row;
}

/** Stable page order: every exported table is ordered by its primary key. */
function exportOrder(table: unknown) {
    const config = getTableConfig(table as never);
    // Drizzle's `primaryKeys` only contains table-level composite keys;
    // column-level `.primaryKey()` declarations live on the column itself.
    const composite = config.primaryKeys.flatMap((key) => key.columns.map((column) => asc(column)));
    if (composite.length > 0) return composite;
    const columnPrimary = config.columns
        .filter((column) => (column as { primary?: boolean }).primary)
        .map((column) => asc(column));
    if (columnPrimary.length > 0) return columnPrimary;
    // `peer_voting_scores` has only a unique index, so fall back to PostgreSQL's
    // physical row identifier to keep LIMIT/OFFSET pages from repeating rows.
    return [sql`ctid`];
}

/** Stream an admin database export without exposing judge links or OAuth client secrets. */
export async function* snapshotDatabaseExport(
    db: DrizzleDatabase,
    format: "json" | "csv",
    liveOverrides: LiveOverrides = {},
) {
    if (format === "json") {
        yield `{"exported_at":${JSON.stringify(new Date().toISOString())},"tables":{`;
    }

    let firstTable = true;
    for (const [name, table] of exportTables) {
        if (format === "json") {
            yield `${firstTable ? "" : ","}${JSON.stringify(name)}:[`;
        } else {
            yield `\r\n--- ${name} ---\r\n`;
        }

        let offset = 0;
        let firstRow = true;
        let headerWritten = false;
        while (true) {
            const rawRows =
                name === "hackathon" && hackathonUsesYaml()
                    ? [{ ...(await readHackathonConfig()), ...liveOverrides }]
                    : ((await db
                          .select()
                          .from(table as any)
                          .orderBy(...exportOrder(table))
                          .limit(PAGE_SIZE)
                          .offset(offset)) as Record<string, unknown>[]);
            if (rawRows.length === 0) break;

            const rows = rawRows.map((row) => anonymizeExportRow(name, row));
            if (format === "csv" && !headerWritten) {
                yield `${Object.keys(rows[0]!).map(csvCell).join(",")}\r\n`;
                headerWritten = true;
            }

            for (const row of rows) {
                if (format === "json") {
                    yield `${firstRow ? "" : ","}${JSON.stringify(row)}`;
                } else {
                    yield `${Object.values(row).map(csvCell).join(",")}\r\n`;
                }
                firstRow = false;
            }

            offset += rawRows.length;
            if (rawRows.length < PAGE_SIZE) break;
        }

        if (format === "json") yield "]";
        firstTable = false;
    }

    if (format === "json") yield "}}";
}
