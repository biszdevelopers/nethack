import * as schema from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";

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
    ["user_past_teams", schema.userPastTeams],
    ["rubric_templates", schema.rubricTemplates],
    ["rubric_versions", schema.rubricVersions],
    ["sc_votes", schema.scVotes],
    ["sqlite_legacy_data", schema.sqliteLegacyData],
] as const;

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
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
