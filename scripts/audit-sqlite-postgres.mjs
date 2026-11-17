#!/usr/bin/env node
import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
    getTargetColumns,
    openSource,
    requireDatabaseUrl,
    rowsFromSource,
    sourceColumns,
    sourceTables,
    validateSource,
} from "./import-sqlite-to-postgres.mjs";
import { IMPORT_TARGET_TABLES } from "./sqlite-import-target.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPORT_PATH = resolve(PROJECT_ROOT, ".tmp-sqlite-postgres-audit.json");
const TABLES = [
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
];
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const isBlank = (value) =>
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "string" && value.trim() === "");

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
    );
}

function comparable(value, dataType) {
    if (value === null || value === undefined) return null;
    if ((dataType === "json" || dataType === "jsonb") && typeof value === "string") {
        try {
            return stable(JSON.parse(value));
        } catch {
            return value;
        }
    }
    if (typeof value === "bigint") return value.toString();
    return stable(value);
}

function keyOf(row, keys, dataColumns) {
    return JSON.stringify(keys.map((key) => comparable(row[key], dataColumns.get(key)?.data_type)));
}

function sourcePrimaryKey(source, tableName) {
    return source
        .prepare(`PRAGMA table_info(${quote(tableName)})`)
        .all()
        .filter((column) => Number(column.pk) > 0)
        .sort((left, right) => Number(left.pk) - Number(right.pk))
        .map((column) => column.name);
}

async function targetPrimaryKey(sql, tableName) {
    const rows = await sql`
        SELECT key_column.column_name
        FROM information_schema.table_constraints AS constraint_info
        JOIN information_schema.key_column_usage AS key_column
          ON key_column.constraint_catalog = constraint_info.constraint_catalog
         AND key_column.constraint_schema = constraint_info.constraint_schema
         AND key_column.constraint_name = constraint_info.constraint_name
        WHERE constraint_info.constraint_type = 'PRIMARY KEY'
          AND constraint_info.table_schema = current_schema()
          AND constraint_info.table_name = ${tableName}
        ORDER BY key_column.ordinal_position
    `;
    return rows.map((row) => row.column_name);
}

function sourceRowsForTable(source, sourceInfo, tableName) {
    if (tableName === "seasons") return sourceInfo.seasons;
    if (tableName === "hackathon") return sourceInfo.hackathonRows;
    if (tableName === "peer_voting_scores") {
        const seasonId =
            sourceInfo.seasons.find((season) => Number(season.is_active) === 1)?.id ??
            sourceInfo.seasons[0]?.id;
        return rowsFromSource(source, tableName).map((row) => ({
            ...row,
            ...(row.season_id === undefined && seasonId !== undefined
                ? { season_id: seasonId }
                : {}),
        }));
    }
    return rowsFromSource(source, tableName);
}

function auditTable({
    tableName,
    source,
    sourceInfo,
    sourceRows,
    targetRows,
    targetColumns,
    targetKey,
}) {
    const sourceKey =
        tableName === "seasons" && sourceInfo.seasonSchema === "single-hackathon"
            ? ["id"]
            : sourcePrimaryKey(source, tableName);
    if (
        tableName === "peer_voting_scores" &&
        sourceRows.some((row) => row.season_id !== undefined) &&
        !sourceKey.includes("season_id")
    ) {
        sourceKey.push("season_id");
    }
    const commonKey = sourceKey.filter((column) => targetColumns.has(column));
    const sourceColumnsList =
        tableName === "seasons" && sourceInfo.seasonSchema === "single-hackathon"
            ? Object.keys(sourceRows[0] ?? {})
            : sourceColumns(source, tableName);
    const comparableColumns = sourceColumnsList.filter((column) => targetColumns.has(column));
    const sourceMap = new Map(sourceRows.map((row) => [keyOf(row, commonKey, targetColumns), row]));
    const targetMap = new Map(targetRows.map((row) => [keyOf(row, targetKey, targetColumns), row]));
    const missingInPostgres = [];
    const missingFields = [];
    const conflicts = [];
    const fieldPresence = Object.fromEntries(
        comparableColumns.map((column) => {
            const sourceNonBlankRows = sourceRows.filter((row) => !isBlank(row[column])).length;
            const postgresNonBlankRows = targetRows.filter((row) => !isBlank(row[column])).length;
            let sourceBlankPostgresNonBlankRows = 0;
            let sourceNonBlankPostgresBlankRows = 0;

            if (commonKey.length > 0 && JSON.stringify(commonKey) === JSON.stringify(targetKey)) {
                for (const sourceRow of sourceRows) {
                    const targetRow = targetMap.get(keyOf(sourceRow, commonKey, targetColumns));
                    if (!targetRow) continue;
                    if (isBlank(sourceRow[column]) && !isBlank(targetRow[column])) {
                        sourceBlankPostgresNonBlankRows += 1;
                    } else if (!isBlank(sourceRow[column]) && isBlank(targetRow[column])) {
                        sourceNonBlankPostgresBlankRows += 1;
                    }
                }
            }

            return [
                column,
                {
                    sourceNonBlankRows,
                    postgresNonBlankRows,
                    sourceBlankPostgresNonBlankRows,
                    sourceNonBlankPostgresBlankRows,
                },
            ];
        }),
    );

    if (commonKey.length === 0 || JSON.stringify(commonKey) !== JSON.stringify(targetKey)) {
        return {
            sourceRows: sourceRows.length,
            postgresRows: targetRows.length,
            sourceKey,
            postgresKey: targetKey,
            status: "manual-key-mapping-required",
            missingInPostgres,
            missingFields,
            conflicts,
            fieldPresence,
        };
    }

    for (const [key, sourceRow] of sourceMap) {
        const targetRow = targetMap.get(key);
        if (!targetRow) {
            missingInPostgres.push({ key: JSON.parse(key) });
            continue;
        }
        for (const column of comparableColumns) {
            const sourceValue = sourceRow[column];
            const targetValue = targetRow[column];
            if (isBlank(targetValue) && !isBlank(sourceValue)) {
                missingFields.push({ key: JSON.parse(key), column });
            } else if (
                !isBlank(targetValue) &&
                !isBlank(sourceValue) &&
                JSON.stringify(comparable(sourceValue, targetColumns.get(column)?.data_type)) !==
                    JSON.stringify(comparable(targetValue, targetColumns.get(column)?.data_type))
            ) {
                conflicts.push({
                    key: JSON.parse(key),
                    column,
                    sqliteValue: sourceValue,
                    postgresValue: targetValue,
                });
            }
        }
    }

    return {
        sourceRows: sourceRows.length,
        postgresRows: targetRows.length,
        sourceKey,
        postgresKey: targetKey,
        status: "compared",
        missingInPostgres,
        missingFields,
        conflicts,
        fieldPresence,
        postgresOnlyRows: [...targetMap.keys()]
            .filter((key) => !sourceMap.has(key))
            .map((key) => ({ key: JSON.parse(key) })),
    };
}

export function buildReconciliationReport({
    source,
    sourceInfo,
    sourceTables: availableTables,
    target,
}) {
    const tables = {};
    for (const tableName of TABLES) {
        if (
            !availableTables.has(tableName) &&
            !(tableName === "seasons" && sourceInfo.seasonSchema === "single-hackathon")
        )
            continue;
        const sourceRows = sourceRowsForTable(source, sourceInfo, tableName);
        const destination = target[tableName];
        if (!destination) {
            tables[tableName] = {
                sourceRows: sourceRows.length,
                postgresRows: null,
                status: "missing-postgres-table",
            };
            continue;
        }
        tables[tableName] = auditTable({
            tableName,
            source,
            sourceInfo,
            sourceRows,
            targetRows: destination.rows,
            targetColumns: destination.columns,
            targetKey: destination.primaryKey,
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        sourcePath: sourceInfo.sourcePath,
        sourceSeasonSchema: sourceInfo.seasonSchema,
        sourceCounts: sourceInfo.counts,
        sourceIntegrity:
            source.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "unknown",
        archivedLegacyRows: {
            removedColumns: sourceInfo.legacyColumnRows.length,
            legacyJudgeRows: sourceInfo.legacyJudgeRows.rows.length,
            orphanedTeamScores: sourceInfo.orphanedTeamScores.rows.length,
        },
        postgresArchivedLegacyRows: target.legacyArchiveCounts ?? {},
        tables,
        note: "Read-only comparison. Review conflicts and take a verified PostgreSQL backup before any reconciliation write.",
    };
}

export async function auditSqliteAgainstPostgres({
    sourcePath = process.env.SQLITE_IMPORT_PATH?.trim(),
    databaseUrl = process.env.DATABASE_URL?.trim(),
    postgresClient = postgres,
} = {}) {
    const { source, sourcePath: resolvedSourcePath } = await openSource(sourcePath);
    const connectionString = requireDatabaseUrl(databaseUrl);
    const sql = postgresClient(connectionString, {
        max: 1,
        connect_timeout: 10,
        prepare: false,
        idle_timeout: 5,
    });
    try {
        const availableTables = sourceTables(source);
        const sourceInfo = validateSource(source, availableTables);
        sourceInfo.sourcePath = resolvedSourcePath;
        const target = {};
        await sql.begin(async (tx) => {
            await tx`SET TRANSACTION READ ONLY`;
            for (const tableName of TABLES) {
                const columns = await getTargetColumns(tx, tableName);
                const primaryKey = await targetPrimaryKey(tx, tableName);
                const rows = await tx.unsafe(`SELECT * FROM ${quote(tableName)}`);
                target[tableName] = { rows, columns, primaryKey };
            }
            // Also verify that every importer-managed destination relation exists.
            for (const tableName of IMPORT_TARGET_TABLES) {
                if (!target[tableName] && tableName !== "sqlite_legacy_data") {
                    await getTargetColumns(tx, tableName);
                }
            }
            const archivedCounts = await tx`
                SELECT table_name, COUNT(*)::int AS row_count
                FROM sqlite_legacy_data
                GROUP BY table_name
            `;
            target.legacyArchiveCounts = Object.fromEntries(
                archivedCounts.map((row) => [row.table_name, row.row_count]),
            );
        });
        return buildReconciliationReport({
            source,
            sourceInfo,
            sourceTables: availableTables,
            target,
        });
    } finally {
        source.close();
        await sql.end({ timeout: 5 });
    }
}

async function writeReport(report, outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    const file = await open(outputPath, "w", 0o600);
    try {
        await file.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    } finally {
        await file.close();
    }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
    if (argv.includes("--apply")) {
        throw new Error(
            "Reconciliation writes are disabled until a reviewed, backed-up target is available.",
        );
    }
    const outputIndex = argv.indexOf("--output");
    const outputPath =
        outputIndex >= 0 ? resolve(argv[outputIndex + 1] ?? "") : DEFAULT_REPORT_PATH;
    if (outputIndex >= 0 && !argv[outputIndex + 1]) {
        throw new Error("Pass a report path after --output.");
    }
    const report = await auditSqliteAgainstPostgres({
        sourcePath: env.SQLITE_IMPORT_PATH,
        databaseUrl: env.DATABASE_URL,
    });
    await writeReport(report, outputPath);
    const summary = Object.fromEntries(
        Object.entries(report.tables).map(([tableName, result]) => [
            tableName,
            {
                sourceRows: result.sourceRows,
                postgresRows: result.postgresRows,
                missingRows: result.missingInPostgres?.length ?? null,
                blankFields: result.missingFields?.length ?? null,
                conflicts: result.conflicts?.length ?? null,
                status: result.status,
            },
        ]),
    );
    console.info(
        JSON.stringify(
            {
                reportPath: outputPath,
                sourceIntegrity: report.sourceIntegrity,
                projectDescriptions: report.tables.teams?.fieldPresence?.project_description,
                archivedLegacyRows: report.archivedLegacyRows,
                postgresArchivedLegacyRows: report.postgresArchivedLegacyRows,
                tables: summary,
            },
            null,
            2,
        ),
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(
            `[SQLite/PostgreSQL audit] ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    });
}
