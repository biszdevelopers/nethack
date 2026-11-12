#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import postgres from "postgres";
import { DEFAULT_RUBRIC_DEFINITION } from "../shared/rubric.ts";
import {
    clearFreshImportTargetSeeds,
    IMPORT_TARGET_TABLES as IMPORT_TABLES,
    inspectFreshImportTarget,
} from "./sqlite-import-target.mjs";

const require = createRequire(import.meta.url);

const SOURCE_TABLES = [
    "hackathon",
    "seasons",
    "teams",
    "users",
    "team_scores",
    "ballots",
    "ballot_scores",
    "oauth2_applications",
    "awards",
    "team_awards",
    "peer_voting_scores",
    "user_past_teams",
    "sc_votes",
    "judge_scores_migrate",
];
const SOURCE_METADATA_TABLES = new Set([
    "__drizzle_migrations",
    "_drizzle_migrations",
    "_cf_METADATA",
]);

const RELATIONSHIPS = [
    ["teams", "season_id", "seasons", "id", true],
    ["users", "team_id", "teams", "id", true],
    ["team_scores", "team_id", "teams", "id", false],
    ["team_scores", "judge_user_id", "users", "id", false],
    ["team_scores", "season_id", "seasons", "id", true],
    ["team_scores", "rubric_version_id", "rubric_versions", "id", false],
    ["ballots", "user_id", "users", "id", false],
    ["ballot_scores", "ballot_id", "ballots", "id", false],
    ["ballot_scores", "project_id", "teams", "id", false],
    ["oauth2_applications", "owner_id", "users", "id", true],
    ["team_awards", "team_id", "teams", "id", false],
    ["team_awards", "award", "awards", "namespace", false],
    ["peer_voting_scores", "user_id", "users", "id", false],
    ["user_past_teams", "user_id", "users", "id", false],
    ["user_past_teams", "team_id", "teams", "id", false],
    ["sc_votes", "user_id", "users", "id", true],
    ["rubric_versions", "season_id", "seasons", "id", false],
    ["rubric_versions", "source_template_id", "rubric_templates", "id", true],
    ["rubric_versions", "created_by", "users", "id", true],
    ["rubric_templates", "created_by", "users", "id", true],
    ["seasons", "rubric_version_id", "rubric_versions", "id", true],
    ["judging_drafts", "team_id", "teams", "id", false],
    ["judging_drafts", "judge_user_id", "users", "id", false],
    ["judging_drafts", "rubric_version_id", "rubric_versions", "id", false],
];

// The season's active rubric pointer is nullable during import; the rubric
// version is inserted before the pointer is restored, so the cyclic table
// relationship remains compatible with ordinary foreign-key enforcement.
const DATABASE_FOREIGN_KEYS = RELATIONSHIPS;

const GENERATED_COLUMNS = new Set();
const ARCHIVED_COLUMNS = {
    users: ["role", "age"],
    seasons: ["submitted_count"],
    team_scores: ["id"],
    oauth2_applications: ["proxy_microsoft"],
};
// These are one-time credentials from the retired login flow. Do not preserve
// them in PostgreSQL: importing them could make stale credentials usable.
const DISCARDED_SOURCE_COLUMNS = {
    users: new Set(["login_code", "login_expiry"]),
};
const LEGACY_TIMESTAMP_FIELDS = [
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
];
const LEGACY_SEASON_ID = 1;
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const asCount = (value) => Number(value ?? 0);
const sourcePathValue = process.env.SQLITE_IMPORT_PATH?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const confirmImport = process.argv.includes("--confirm");
const checkOnly = process.argv.includes("--check-only");

async function openSource() {
    if (!sourcePathValue) {
        throw new Error("Set SQLITE_IMPORT_PATH to the SQLite backup that will be imported.");
    }
    const sourcePath = resolve(sourcePathValue);
    if (!existsSync(sourcePath))
        throw new Error(`SQLite import file does not exist: ${sourcePath}`);
    let source;
    if (process.versions.bun) {
        const { Database } = await import("bun:sqlite");
        source = new Database(sourcePath, { readonly: true, create: false });
    } else {
        const BetterSqlite = require("better-sqlite3");
        source = new BetterSqlite(sourcePath, { readonly: true, fileMustExist: true });
    }
    source.exec("PRAGMA query_only = ON");
    return { source, sourcePath: realpathSync(sourcePath) };
}

function sourceTables(source) {
    return new Set(
        source
            .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ?")
            .all("table", "sqlite_%")
            .map(({ name }) => name),
    );
}

function validateSourceTables(availableTables) {
    const unknownTables = [...availableTables].filter(
        (tableName) => !SOURCE_TABLES.includes(tableName) && !SOURCE_METADATA_TABLES.has(tableName),
    );
    if (unknownTables.length) {
        throw new Error(
            `SQLite source contains unrecognized non-metadata table(s): ${unknownTables.join(", ")}. ` +
                "Review and map every table before importing; no source data was changed.",
        );
    }
    return [...availableTables].filter((tableName) => SOURCE_METADATA_TABLES.has(tableName));
}

function sourceColumns(source, tableName) {
    return source
        .prepare(`PRAGMA table_info(${quote(tableName)})`)
        .all()
        .map(({ name }) => name);
}

function countSourceRows(source, tableName) {
    return asCount(source.prepare(`SELECT count(*) AS count FROM ${quote(tableName)}`).get().count);
}

function rowsFromSource(source, tableName) {
    return source.prepare(`SELECT * FROM ${quote(tableName)}`).all();
}

function checkSourceRelationships(source, availableTables) {
    const failures = [];
    for (const [childTable, childColumn, parentTable, parentColumn, nullable] of RELATIONSHIPS) {
        if (!availableTables.has(childTable) || !availableTables.has(parentTable)) continue;
        const childColumns = new Set(sourceColumns(source, childTable));
        const parentColumns = new Set(sourceColumns(source, parentTable));
        if (!childColumns.has(childColumn) || !parentColumns.has(parentColumn)) continue;
        const nullFilter = nullable ? ` AND c.${quote(childColumn)} IS NOT NULL` : "";
        const result = source
            .prepare(
                `SELECT count(*) AS count FROM ${quote(childTable)} c LEFT JOIN ${quote(parentTable)} p ` +
                    `ON p.${quote(parentColumn)} = c.${quote(childColumn)} ` +
                    `WHERE p.${quote(parentColumn)} IS NULL${nullFilter}`,
            )
            .get();
        const count = asCount(result.count);
        if (count > 0) failures.push(`${childTable}.${childColumn} has ${count} orphan row(s)`);
    }
    return failures;
}

function prepareLegacyJudgeRows(source, availableTables) {
    if (!availableTables.has("judge_scores_migrate"))
        return { rows: [], sourceCount: 0, headerCount: 0 };
    const rows = rowsFromSource(source, "judge_scores_migrate");
    const columns = sourceColumns(source, "judge_scores_migrate");
    const expected = ["field1", "field2", "field3", "field4", "field5"];
    if (expected.some((column) => !columns.includes(column))) {
        throw new Error(
            "judge_scores_migrate has an unexpected schema; refusing to discard legacy score data.",
        );
    }
    const isHeader = (row) =>
        row.field1 === "id" &&
        row.field2 === "team_id" &&
        row.field3 === "judge_user_id" &&
        row.field4 === "scores" &&
        row.field5 === "reasoning";
    const headers = rows.filter(isHeader);
    if (headers.length > 1) throw new Error("judge_scores_migrate contains duplicate header rows.");
    const dataRows = rows.filter((row) => !isHeader(row));
    const keys = new Set();
    for (const row of dataRows) {
        const key = String(row.field1 ?? "").trim();
        if (!key || keys.has(key)) {
            throw new Error("judge_scores_migrate contains a missing or duplicate legacy row key.");
        }
        keys.add(key);
    }
    return { rows: dataRows, sourceCount: rows.length, headerCount: headers.length };
}

function prepareLegacyColumnRows(source, availableTables) {
    const legacyRows = [];
    for (const [tableName, fields] of Object.entries(ARCHIVED_COLUMNS)) {
        if (!availableTables.has(tableName)) continue;
        const columns = new Set(sourceColumns(source, tableName));
        const archivedFields = fields.filter((field) => columns.has(field));
        if (!archivedFields.length) continue;
        const keyColumn = tableName === "oauth2_applications" ? "client_id" : "id";
        if (!columns.has(keyColumn)) {
            throw new Error(
                `${tableName} is missing ${keyColumn}; cannot preserve its legacy values safely.`,
            );
        }
        for (const row of rowsFromSource(source, tableName)) {
            const payload = Object.fromEntries(archivedFields.map((field) => [field, row[field]]));
            legacyRows.push({
                table_name: tableName,
                row_key: String(row[keyColumn]),
                payload,
            });
        }
    }
    return legacyRows;
}

function normalizeLegacyTimestamp(value, field) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(
            `Legacy hackathon ${field} is missing or invalid; refusing to alter event timing.`,
        );
    }
    const raw = value.trim();
    if (/^-?\d+$/.test(raw)) {
        const integer = Number(raw);
        if (Number.isSafeInteger(integer)) return integer;
    }
    const timestamp = Date.parse(raw);
    if (Number.isSafeInteger(timestamp)) return timestamp;
    throw new Error(
        `Legacy hackathon ${field} is not a valid epoch millisecond value or ISO date; refusing to alter event timing.`,
    );
}

function normalizeLegacyHackathonRow(row) {
    const normalized = { ...row };
    for (const field of LEGACY_TIMESTAMP_FIELDS) {
        if (!(field in normalized)) {
            throw new Error(
                `Legacy hackathon is missing ${field}; refusing to alter event timing.`,
            );
        }
        normalized[field] = normalizeLegacyTimestamp(normalized[field], field);
    }
    return normalized;
}

function detectSeasonSchema(source, availableTables) {
    const teamColumns = new Set(sourceColumns(source, "teams"));
    const scoreColumns = new Set(sourceColumns(source, "team_scores"));
    const hasSeasonTable = availableTables.has("seasons");
    const teamsHaveSeasonId = teamColumns.has("season_id");
    const scoresHaveSeasonId = scoreColumns.has("season_id");

    if (hasSeasonTable) {
        if (!teamsHaveSeasonId || !scoresHaveSeasonId) {
            throw new Error(
                "SQLite source has a partial season schema; a seasons table requires season_id on both teams and team_scores.",
            );
        }
        const seasons = rowsFromSource(source, "seasons");
        if (!seasons.length) {
            throw new Error(
                "SQLite source contains a seasons table but no seasons; refusing to infer history.",
            );
        }
        return { kind: "seasonal", seasons };
    }

    if (teamsHaveSeasonId || scoresHaveSeasonId || scoreColumns.has("rubric_version_id")) {
        throw new Error(
            "SQLite source has a partial season schema; without a seasons table, teams and team_scores must both omit season_id and team_scores must omit rubric_version_id.",
        );
    }

    return { kind: "single-hackathon", seasons: null };
}

function makeLegacySeason(hackathon) {
    return {
        id: LEGACY_SEASON_ID,
        name: "Imported legacy season",
        is_active: 1,
        status: hackathon.status,
        voting_enabled: hackathon.voting_enabled ?? 0,
        results_published: hackathon.results_published ?? 0,
        judging_open: hackathon.judging_open ?? 0,
        show_scores: hackathon.show_scores ?? 0,
        show_ranking: hackathon.show_ranking ?? 0,
        max_votes_per_user: hackathon.max_votes_per_user ?? 0,
        schedule_start: hackathon.schedule_start ?? null,
        schedule_end: hackathon.schedule_end ?? null,
        start_timestamp: hackathon.start_timestamp ?? 0,
        end_timestamp: hackathon.end_timestamp ?? 0,
        voting_start_timestamp: hackathon.voting_start_timestamp ?? 0,
        voting_end_timestamp: hackathon.voting_end_timestamp ?? 0,
        results_open_timestamp: hackathon.results_open_timestamp ?? 0,
        theme_name: hackathon.theme_name ?? null,
        theme_description: hackathon.theme_description ?? null,
        score_curve_preset: "original",
        rubric_version_id: null,
    };
}

function validateSource(source, availableTables) {
    const metadataTables = validateSourceTables(availableTables);
    for (const requiredTable of ["hackathon", "teams", "users", "team_scores"]) {
        if (!availableTables.has(requiredTable)) {
            throw new Error(`SQLite source is missing required table: ${requiredTable}`);
        }
    }
    const seasonSchema = detectSeasonSchema(source, availableTables);
    const relationshipFailures = checkSourceRelationships(source, availableTables);
    if (relationshipFailures.length) {
        throw new Error(
            `SQLite source has broken relationships; repair or restore a verified backup before import:\n- ${relationshipFailures.join("\n- ")}`,
        );
    }
    const sourceHackathonRows = rowsFromSource(source, "hackathon");
    const hackathonRows =
        seasonSchema.kind === "single-hackathon"
            ? sourceHackathonRows.map(normalizeLegacyHackathonRow)
            : sourceHackathonRows;
    if (hackathonRows.length !== 1 || Number(hackathonRows[0].id) !== 1) {
        throw new Error(
            "SQLite source must contain exactly the canonical hackathon row with id = 1.",
        );
    }
    const seasons =
        seasonSchema.kind === "single-hackathon"
            ? [makeLegacySeason(hackathonRows[0])]
            : seasonSchema.seasons;
    const activeSeasons = seasons.filter((season) => Number(season.is_active) === 1);
    if (activeSeasons.length > 1) throw new Error("SQLite source has more than one active season.");

    const legacyJudgeRows = prepareLegacyJudgeRows(source, availableTables);
    const legacyColumnRows = prepareLegacyColumnRows(source, availableTables);
    const counts = Object.fromEntries(
        SOURCE_TABLES.filter((table) => availableTables.has(table)).map((table) => [
            table,
            countSourceRows(source, table),
        ]),
    );
    const targetCountExpectations = { ...counts };
    if (seasonSchema.kind === "single-hackathon") targetCountExpectations.seasons = 1;
    return {
        counts,
        targetCountExpectations,
        seasons,
        hackathonRows,
        seasonSchema: seasonSchema.kind,
        legacyJudgeRows,
        legacyColumnRows,
        metadataTables,
    };
}

function requireDatabaseUrl() {
    if (!databaseUrl)
        throw new Error("DATABASE_URL must point to the empty PostgreSQL target database.");
    let parsed;
    try {
        parsed = new URL(databaseUrl);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error("DATABASE_URL must use postgres:// or postgresql:// and include a host.");
    }
}

async function getTargetColumns(sql, tableName) {
    const rows = await sql`
        SELECT column_name, data_type, is_identity, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${tableName}
        ORDER BY ordinal_position
    `;
    if (!rows.length)
        throw new Error(`PostgreSQL table is missing: ${tableName}; run migrations first.`);
    return new Map(rows.map((row) => [row.column_name, row]));
}

async function targetRows(sql, tableName) {
    const [row] = await sql.unsafe(`SELECT count(*)::bigint AS count FROM ${quote(tableName)}`);
    return asCount(row.count);
}

async function ensureEmptyTarget(sql, columnsByTable) {
    const counts = {};
    for (const tableName of IMPORT_TABLES) {
        counts[tableName] = await targetRows(sql, tableName);
    }

    const rows = {};
    for (const tableName of ["hackathon", "seasons", "rubric_templates", "rubric_versions"]) {
        if (counts[tableName] === 1) {
            const [row] = await sql.unsafe(`SELECT * FROM ${quote(tableName)}`);
            rows[tableName] = row;
        }
    }

    const seedPlan = inspectFreshImportTarget({ counts, rows });
    if (!seedPlan) {
        const populated = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([tableName, count]) => `${tableName} (${count})`);
        throw new Error(
            `PostgreSQL target contains data outside the exact fresh-migration seed state${populated.length ? `: ${populated.join(", ")}` : "."} Import only into a newly migrated, otherwise empty database.`,
        );
    }

    for (const tableName of SOURCE_TABLES.filter(
        (name) => name !== "judge_scores_migrate" && columnsByTable.has(name),
    )) {
        const columns = columnsByTable.get(tableName);
        const inputColumns = new Set(sourceColumnsForTargetCheck.get(tableName) ?? []);
        for (const sourceColumn of inputColumns) {
            if (
                columns.has(sourceColumn) ||
                GENERATED_COLUMNS.has(`${tableName}.${sourceColumn}`) ||
                DISCARDED_SOURCE_COLUMNS[tableName]?.has(sourceColumn)
            )
                continue;
            if (ARCHIVED_COLUMNS[tableName]?.includes(sourceColumn)) continue;
            throw new Error(
                `SQLite field ${tableName}.${sourceColumn} has no PostgreSQL destination; add an explicit mapping or archive before importing.`,
            );
        }
    }
    return seedPlan;
}

// This map is assigned after opening SQLite so target compatibility checks can
// fail before the PostgreSQL transaction writes any rows.
const sourceColumnsForTargetCheck = new Map();

async function insertRows(sql, tableName, rows, columnsByTable, overrides = () => ({})) {
    if (!rows.length) return 0;
    const targetColumns = columnsByTable.get(tableName);
    const sourceColumns = Object.keys(rows[0]);
    const columns = sourceColumns.filter((column) => targetColumns.has(column));
    const overrideColumns = new Set(rows.flatMap((row) => Object.keys(overrides(row))));
    for (const column of overrideColumns) {
        if (!targetColumns.has(column))
            throw new Error(`PostgreSQL table ${tableName} is missing required column ${column}.`);
        if (!columns.includes(column)) columns.push(column);
    }
    const jsonColumns = new Set(
        columns.filter((column) => targetColumns.get(column).data_type === "jsonb"),
    );
    const chunkSize = Math.max(1, Math.floor(8000 / columns.length));
    for (let start = 0; start < rows.length; start += chunkSize) {
        const batch = rows.slice(start, start + chunkSize);
        const params = [];
        const valueRows = batch.map((row) => {
            const merged = { ...row, ...overrides(row) };
            const placeholders = columns.map((column) => {
                params.push(
                    jsonColumns.has(column) ? JSON.stringify(merged[column]) : merged[column],
                );
                return `$${params.length}${jsonColumns.has(column) ? "::jsonb" : ""}`;
            });
            return `(${placeholders.join(", ")})`;
        });
        const statement = `INSERT INTO ${quote(tableName)} (${columns.map(quote).join(", ")}) VALUES ${valueRows.join(", ")}`;
        await sql.unsafe(statement, params);
    }
    return rows.length;
}

async function insertLegacyArchive(sql, rows) {
    if (!rows.length) return 0;
    const values = [];
    const tuples = rows.map((row) => {
        values.push(row.table_name, row.row_key, JSON.stringify(row.payload));
        const offset = values.length - 2;
        return `($${offset}, $${offset + 1}, $${offset + 2}::jsonb)`;
    });
    const statement =
        "INSERT INTO sqlite_legacy_data (table_name, row_key, payload) VALUES " + tuples.join(", ");
    await sql.unsafe(statement, values);
    return rows.length;
}

async function insertRubricVersions(sql, seasons) {
    const seasonRubricIds = new Map();
    for (const season of seasons) {
        const [version] = await sql`
            INSERT INTO rubric_versions (season_id, version, name, definition)
            VALUES (${season.id}, 1, ${"Imported legacy rubric"}, ${sql.json(DEFAULT_RUBRIC_DEFINITION)})
            RETURNING id
        `;
        seasonRubricIds.set(Number(season.id), Number(version.id));
    }
    for (const [seasonId, rubricVersionId] of seasonRubricIds) {
        await sql`UPDATE seasons SET rubric_version_id = ${rubricVersionId} WHERE id = ${seasonId}`;
    }
    return seasonRubricIds;
}

function importSeasonForScore(row, teams, activeSeasonId) {
    if (row.season_id !== null && row.season_id !== undefined) return Number(row.season_id);
    const teamSeason = teams.get(Number(row.team_id));
    return Number(teamSeason ?? activeSeasonId ?? 1);
}

async function validateTargetRelationships(sql) {
    const failures = [];
    for (const [childTable, childColumn, parentTable, parentColumn, nullable] of RELATIONSHIPS) {
        const nullFilter = nullable ? ` AND c.${quote(childColumn)} IS NOT NULL` : "";
        const [result] = await sql.unsafe(
            `SELECT count(*)::bigint AS count FROM ${quote(childTable)} c ` +
                `LEFT JOIN ${quote(parentTable)} p ON p.${quote(parentColumn)} = c.${quote(childColumn)} ` +
                `WHERE p.${quote(parentColumn)} IS NULL${nullFilter}`,
        );
        const count = asCount(result.count);
        if (count > 0) failures.push(`${childTable}.${childColumn} has ${count} orphan row(s)`);
    }
    if (failures.length)
        throw new Error(
            `Imported PostgreSQL relationships failed verification:\n- ${failures.join("\n- ")}`,
        );
}

async function validateTargetForeignKeys(sql) {
    const rows = await sql`
        SELECT
            source.relname AS table_name,
            source_column.attname AS column_name,
            target.relname AS foreign_table_name,
            target_column.attname AS foreign_column_name
        FROM pg_constraint constraint_row
        JOIN pg_class source ON source.oid = constraint_row.conrelid
        JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
        JOIN pg_class target ON target.oid = constraint_row.confrelid
        JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, position) ON true
        JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, position)
            ON target_key.position = source_key.position
        JOIN pg_attribute source_column ON source_column.attrelid = source.oid AND source_column.attnum = source_key.attnum
        JOIN pg_attribute target_column ON target_column.attrelid = target.oid AND target_column.attnum = target_key.attnum
        WHERE constraint_row.contype = 'f' AND source_schema.nspname = current_schema()
    `;
    const actual = new Set(
        rows.map(
            (row) =>
                `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}`,
        ),
    );
    const missing = DATABASE_FOREIGN_KEYS.map(
        ([table, column, foreignTable, foreignColumn]) =>
            `${table}.${column}->${foreignTable}.${foreignColumn}`,
    ).filter((relationship) => !actual.has(relationship));
    if (missing.length) {
        throw new Error(
            `PostgreSQL schema is missing required foreign keys:\n- ${missing.join("\n- ")}`,
        );
    }
}

async function setIdentitySequences(sql) {
    for (const tableName of [
        "teams",
        "users",
        "ballots",
        "ballot_scores",
        "seasons",
        "rubric_versions",
        "sc_votes",
    ]) {
        await sql.unsafe(
            `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), ` +
                `GREATEST(COALESCE((SELECT max(id) FROM ${quote(tableName)}), 1), 1), ` +
                `COALESCE((SELECT max(id) FROM ${quote(tableName)}), 0) > 0)`,
        );
    }
}

async function importToPostgres(source, availableTables, sourceInfo) {
    requireDatabaseUrl();
    const sql = postgres(databaseUrl, {
        max: 1,
        connect_timeout: 10,
        prepare: false,
        idle_timeout: 5,
    });
    try {
        const columnsByTable = new Map();
        for (const tableName of IMPORT_TABLES) {
            columnsByTable.set(tableName, await getTargetColumns(sql, tableName));
        }
        for (const tableName of SOURCE_TABLES) {
            if (availableTables.has(tableName)) {
                sourceColumnsForTargetCheck.set(tableName, sourceColumns(source, tableName));
            }
        }
        await sql.begin(async (tx) => {
            await tx`SET LOCAL lock_timeout = '5s'`;
            await tx`SELECT pg_advisory_xact_lock(75110114284009)`;
            await tx.unsafe(
                `LOCK TABLE ${IMPORT_TABLES.map(quote).join(", ")} IN ACCESS EXCLUSIVE MODE`,
            );
            const seedPlan = await ensureEmptyTarget(tx, columnsByTable);
            await clearFreshImportTargetSeeds(tx, seedPlan);

            const sourceSeasons = sourceInfo.seasons.map((season) => ({
                ...season,
                rubric_version_id: null,
            }));
            await insertRows(tx, "seasons", sourceSeasons, columnsByTable, () => ({
                rubric_version_id: null,
            }));
            await insertRows(
                tx,
                "teams",
                rowsFromSource(source, "teams"),
                columnsByTable,
                sourceInfo.seasonSchema === "single-hackathon"
                    ? () => ({ season_id: LEGACY_SEASON_ID })
                    : undefined,
            );
            await insertRows(tx, "users", rowsFromSource(source, "users"), columnsByTable);

            const seasonRubricIds = await insertRubricVersions(tx, sourceInfo.seasons);
            const activeSeasonId = Number(
                sourceInfo.seasons.find((season) => Number(season.is_active) === 1)?.id ??
                    sourceInfo.seasons[0]?.id,
            );
            const teams = new Map(
                rowsFromSource(source, "teams").map((team) => [
                    Number(team.id),
                    Number(team.season_id ?? 1),
                ]),
            );
            const scores = rowsFromSource(source, "team_scores").map((row) => {
                const seasonId = importSeasonForScore(row, teams, activeSeasonId);
                const rubricVersionId = seasonRubricIds.get(seasonId);
                if (!rubricVersionId) {
                    throw new Error(
                        `No imported rubric version exists for team_scores season ${seasonId}; refusing to alter score history.`,
                    );
                }
                return {
                    ...row,
                    __seasonId: seasonId,
                    __rubricVersionId: rubricVersionId,
                };
            });
            await insertRows(tx, "team_scores", scores, columnsByTable, (row) => ({
                season_id: row.__seasonId,
                rubric_version_id: row.__rubricVersionId,
            }));
            await insertRows(tx, "hackathon", sourceInfo.hackathonRows, columnsByTable);

            for (const tableName of [
                "ballots",
                "ballot_scores",
                "oauth2_applications",
                "awards",
                "team_awards",
                "peer_voting_scores",
                "user_past_teams",
                "sc_votes",
            ]) {
                if (availableTables.has(tableName)) {
                    await insertRows(
                        tx,
                        tableName,
                        rowsFromSource(source, tableName),
                        columnsByTable,
                    );
                }
            }

            const archiveRows = [
                ...sourceInfo.legacyColumnRows,
                ...sourceInfo.legacyJudgeRows.rows.map((row) => ({
                    table_name: "judge_scores_migrate",
                    row_key: String(row.field1),
                    payload: row,
                })),
            ];
            await insertLegacyArchive(tx, archiveRows);

            await setIdentitySequences(tx);
            await validateTargetRelationships(tx);
            await validateTargetForeignKeys(tx);

            const targetCounts = {};
            for (const [tableName, expectedCount] of Object.entries(
                sourceInfo.targetCountExpectations,
            )) {
                if (!columnsByTable.has(tableName)) continue;
                const actualCount = await targetRows(tx, tableName);
                targetCounts[tableName] = actualCount;
                if (actualCount !== expectedCount) {
                    throw new Error(
                        `Row-count verification failed for ${tableName}: SQLite has ${expectedCount}, PostgreSQL has ${actualCount}.`,
                    );
                }
            }
            for (const tableName of IMPORT_TABLES) {
                if (!(tableName in targetCounts)) {
                    targetCounts[tableName] = await targetRows(tx, tableName);
                }
            }
            const archivedLegacyExpected =
                sourceInfo.legacyColumnRows.length + sourceInfo.legacyJudgeRows.rows.length;
            const legacyActual = await targetRows(tx, "sqlite_legacy_data");
            if (legacyActual !== archivedLegacyExpected) {
                throw new Error(
                    `Legacy archive verification failed: expected ${archivedLegacyExpected} rows, found ${legacyActual}.`,
                );
            }

            console.log(
                JSON.stringify(
                    {
                        sourcePath: sourceInfo.sourcePath,
                        sourceCounts: sourceInfo.counts,
                        seasonSchema: sourceInfo.seasonSchema,
                        ...(sourceInfo.seasonSchema === "single-hackathon"
                            ? { legacySeasonMapping: { seasonId: LEGACY_SEASON_ID } }
                            : {}),
                        targetCounts,
                        ignoredMetadataTables: sourceInfo.metadataTables,
                        legacyArchiveRows: legacyActual,
                        judgeScoresArtifactRows: {
                            sourceRows: sourceInfo.legacyJudgeRows.sourceCount,
                            headerRowsExcluded: sourceInfo.legacyJudgeRows.headerCount,
                            archivedDataRows: sourceInfo.legacyJudgeRows.rows.length,
                        },
                        foreignKeys:
                            "all required target constraints present; source and target have no orphan references",
                        result: "committed",
                    },
                    null,
                    2,
                ),
            );
        });
    } finally {
        await sql.end({ timeout: 5 });
    }
}

async function main() {
    if (checkOnly && confirmImport)
        throw new Error("Choose either --check-only or --confirm, not both.");
    if (!checkOnly && !confirmImport) {
        throw new Error(
            "This is a write operation. Review the source and pass --confirm to perform the import.",
        );
    }
    const { source, sourcePath } = await openSource();
    try {
        const availableTables = sourceTables(source);
        const sourceInfo = validateSource(source, availableTables);
        sourceInfo.sourcePath = sourcePath;
        if (checkOnly) {
            console.log(
                JSON.stringify(
                    {
                        sourcePath,
                        sourceRows: sourceInfo.counts,
                        seasonSchema: sourceInfo.seasonSchema,
                        ...(sourceInfo.seasonSchema === "single-hackathon"
                            ? { legacySeasonMapping: { seasonId: LEGACY_SEASON_ID } }
                            : {}),
                        ignoredMetadataTables: sourceInfo.metadataTables,
                        legacyArchiveRows:
                            sourceInfo.legacyColumnRows.length +
                            sourceInfo.legacyJudgeRows.rows.length,
                        judgeScoresArtifactRows: {
                            sourceRows: sourceInfo.legacyJudgeRows.sourceCount,
                            headerRowsExcluded: sourceInfo.legacyJudgeRows.headerCount,
                            archivedDataRows: sourceInfo.legacyJudgeRows.rows.length,
                        },
                        result: "source checks passed; PostgreSQL was not contacted",
                    },
                    null,
                    2,
                ),
            );
            return;
        }
        await importToPostgres(source, availableTables, sourceInfo);
    } finally {
        source.close();
    }
}

main().catch((error) => {
    console.error(`[SQLite import] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
