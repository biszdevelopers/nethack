import * as schema from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { asc, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

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
    ["sc_votes", schema.scVotes],
    ["sqlite_legacy_data", schema.sqliteLegacyData],
] as const;

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
    const hasFormulaPrefix = /^[\s\p{Cc}]*[=+\-@]/u.test(raw);
    const startsWithSpreadsheetControl = /^[\t\r]/.test(raw);
    const safe = hasFormulaPrefix || startsWithSpreadsheetControl ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
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
export async function* snapshotDatabaseExport(db: DrizzleDatabase, format: "json" | "csv") {
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
            const rawRows = (await db
                .select()
                .from(table as any)
                .orderBy(...exportOrder(table))
                .limit(PAGE_SIZE)
                .offset(offset)) as Record<string, unknown>[];
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
