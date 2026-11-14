import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    checkSourceRelationships,
    classifyOrphanedTeamScores,
    countSourceRows,
    detectSeasonSchema,
    ensureEmptyTarget,
    getTargetColumns,
    importSeasonForScore,
    importToPostgres,
    insertLegacyArchive,
    insertRows,
    insertRubricVersions,
    main,
    makeLegacySeason,
    normalizeLegacyHackathonRow,
    normalizeLegacyTimestamp,
    openSource,
    prepareLegacyColumnRows,
    prepareLegacyJudgeRows,
    requireDatabaseUrl,
    rowsFromSource,
    runCli,
    setIdentitySequences,
    sourceColumns,
    sourceTables,
    targetRows,
    validateSource,
    validateSourceTables,
    validateTargetForeignKeys,
    validateTargetRelationships,
    DATABASE_FOREIGN_KEYS,
} from "../../scripts/import-sqlite-to-postgres.mjs";
import { IMPORT_TARGET_TABLES } from "../../scripts/sqlite-import-target.mjs";

const temporaryDirectories: string[] = [];

const createSource = (schema: "seasonal" | "legacy" = "seasonal", filename = ":memory:") => {
    const db = new Database(filename);
    db.exec(`
        CREATE TABLE hackathon (
            id INTEGER PRIMARY KEY, status TEXT NOT NULL,
            voting_enabled INTEGER DEFAULT 0, results_published INTEGER DEFAULT 0,
            judging_open INTEGER DEFAULT 0, show_scores INTEGER DEFAULT 0,
            show_ranking INTEGER DEFAULT 0, max_votes_per_user INTEGER DEFAULT 0,
            schedule_start TEXT, schedule_end TEXT,
            start_timestamp, end_timestamp, voting_start_timestamp,
            voting_end_timestamp, results_open_timestamp,
            theme_name TEXT, theme_description TEXT
        );
        CREATE TABLE teams (id INTEGER PRIMARY KEY${schema === "seasonal" ? ", season_id INTEGER" : ""});
        CREATE TABLE users (
            id INTEGER PRIMARY KEY, team_id INTEGER, role TEXT, age INTEGER,
            login_code TEXT, login_expiry INTEGER
        );
        CREATE TABLE team_scores (
            team_id INTEGER, judge_user_id INTEGER${schema === "seasonal" ? ", season_id INTEGER, rubric_version_id INTEGER" : ""}
        );
        CREATE TABLE ballots (id INTEGER PRIMARY KEY, user_id INTEGER, reasoning TEXT, submitted INTEGER);
    `);

    if (schema === "seasonal") {
        db.exec(`
            CREATE TABLE seasons (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL,
                status TEXT NOT NULL, voting_enabled INTEGER DEFAULT 0,
                results_published INTEGER DEFAULT 0, judging_open INTEGER DEFAULT 0,
                show_scores INTEGER DEFAULT 0, show_ranking INTEGER DEFAULT 0,
                max_votes_per_user INTEGER DEFAULT 0, schedule_start TEXT, schedule_end TEXT,
                start_timestamp, end_timestamp, voting_start_timestamp,
                voting_end_timestamp, results_open_timestamp, theme_name TEXT,
                theme_description TEXT, score_curve_preset TEXT DEFAULT 'original',
                rubric_version_id INTEGER
            );
            INSERT INTO seasons (id, name, is_active, status) VALUES (1, 'Fixture', 1, 'finished');
        `);
    }

    db.exec(`
        INSERT INTO hackathon (
            id, status, start_timestamp, end_timestamp, voting_start_timestamp,
            voting_end_timestamp, results_open_timestamp
        ) VALUES (
            1, 'finished', '2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z',
            '2026-05-01T12:00:00Z', '2026-05-01T18:00:00Z', '2026-05-02T00:00:00Z'
        );
    `);
    if (schema === "seasonal") db.exec("INSERT INTO teams (id, season_id) VALUES (3, 1)");
    else db.exec("INSERT INTO teams (id) VALUES (3)");
    db.exec("INSERT INTO users (id, team_id) VALUES (7, NULL)");
    if (schema === "seasonal") {
        db.exec(
            "INSERT INTO team_scores (team_id, judge_user_id, season_id, rubric_version_id) VALUES (3, 7, 1, 1)",
        );
    } else {
        db.exec("INSERT INTO team_scores (team_id, judge_user_id) VALUES (3, 7)");
    }
    return db;
};

const inTemporaryDirectory = (action: (directory: string) => void) => {
    const directory = mkdtempSync(resolve(tmpdir(), "basishacks-sqlite-import-"));
    temporaryDirectories.push(directory);
    action(directory);
};

const targetColumns = (source: Database.Database) => {
    const tables = new Map<string, Map<string, Record<string, unknown>>>();
    for (const table of IMPORT_TARGET_TABLES) {
        let columns: string[] = [];
        try {
            columns = sourceColumns(source, table);
        } catch {
            // Tables absent from SQLite still exist in PostgreSQL and are tested below.
        }
        if (table === "rubric_templates")
            columns = ["id", "name", "description", "definition", "created_by"];
        if (table === "rubric_versions")
            columns = [
                "id",
                "season_id",
                "version",
                "name",
                "definition",
                "source_template_id",
                "created_by",
            ];
        if (table === "judging_drafts")
            columns = [
                "id",
                "team_id",
                "judge_user_id",
                "rubric_version_id",
                "scores",
                "reasoning",
            ];
        if (table === "sqlite_legacy_data") columns = ["table_name", "row_key", "payload"];
        if (table === "seasons") {
            columns = [
                ...new Set([
                    ...columns,
                    "id",
                    "name",
                    "is_active",
                    "status",
                    "voting_enabled",
                    "results_published",
                    "judging_open",
                    "show_scores",
                    "show_ranking",
                    "max_votes_per_user",
                    "schedule_start",
                    "schedule_end",
                    "start_timestamp",
                    "end_timestamp",
                    "voting_start_timestamp",
                    "voting_end_timestamp",
                    "results_open_timestamp",
                    "theme_name",
                    "theme_description",
                    "score_curve_preset",
                    "rubric_version_id",
                ]),
            ];
        }
        if (table === "teams") {
            if (!columns.includes("season_id")) columns.push("season_id");
            if (!columns.includes("sourcing")) columns.push("sourcing");
        }
        if (table === "team_scores")
            columns = [...new Set([...columns, "season_id", "rubric_version_id"])];
        if (columns.length === 0) columns = ["id"];
        tables.set(
            table,
            new Map(
                columns.map((column) => [
                    column,
                    {
                        column_name: column,
                        data_type:
                            column === "definition" || column === "payload" ? "jsonb" : "text",
                    },
                ]),
            ),
        );
    }
    return tables;
};

const createPostgresDouble = (
    source: Database.Database,
    overrides: { populated?: boolean; mismatch?: boolean; archiveMismatch?: boolean } = {},
) => {
    const columns = targetColumns(source);
    const counts = Object.fromEntries(IMPORT_TARGET_TABLES.map((table) => [table, 0])) as Record<
        string,
        number
    >;
    const state = { inTransaction: false, statements: [] as string[], legacyCountReads: 0 };
    const sql: any = async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const statement = parts.join(" ").replace(/\s+/g, " ");
        state.statements.push(statement);
        if (statement.includes("information_schema.columns")) {
            const table = String(values[0]);
            const rows = [...(columns.get(table)?.values() ?? [])];
            return rows;
        }
        if (statement.includes("INSERT INTO rubric_versions")) {
            counts.rubric_versions += 1;
            return [{ id: 2 }];
        }
        if (statement.includes("FROM pg_constraint")) {
            return DATABASE_FOREIGN_KEYS.map(
                ([table_name, column_name, foreign_table_name, foreign_column_name]) => ({
                    table_name,
                    column_name,
                    foreign_table_name,
                    foreign_column_name,
                }),
            );
        }
        return [];
    };
    sql.unsafe = vi.fn(async (statement: string, params: unknown[] = []) => {
        state.statements.push(statement);
        if (/SELECT count\(\*\)::bigint AS count FROM "[^"]+" c LEFT JOIN/.test(statement)) {
            return [{ count: 0 }];
        }
        const countQuery = statement.match(/SELECT count\(\*\)::bigint AS count FROM "([^"]+)"/);
        if (countQuery) {
            const table = countQuery[1];
            if (table === "sqlite_legacy_data") state.legacyCountReads += 1;
            if (
                overrides.archiveMismatch &&
                table === "sqlite_legacy_data" &&
                state.legacyCountReads > 2
            ) {
                return [{ count: 0 }];
            }
            const count =
                overrides.mismatch && table === "hackathon" && counts[table] > 0
                    ? 0
                    : counts[table];
            return [{ count }];
        }
        const insert = statement.match(/INSERT INTO "([^"]+)" \(([^)]+)\) VALUES/);
        if (insert) {
            const table = insert[1];
            const columnCount = insert[2].split(",").length;
            counts[table] += Math.floor(params.length / columnCount);
        }
        if (statement.startsWith("INSERT INTO sqlite_legacy_data")) {
            counts.sqlite_legacy_data += Math.floor(params.length / 3);
        }
        if (overrides.populated && statement.includes('SELECT * FROM "hackathon"')) {
            return [{ id: 9 }];
        }
        if (statement.includes('SELECT * FROM "hackathon"')) return [];
        return [];
    });
    sql.end = vi.fn(async () => undefined);
    sql.json = (value: unknown) => value;
    sql.begin = vi.fn(async (callback: (tx: typeof sql) => Promise<unknown>) => {
        state.inTransaction = true;
        return callback(sql);
    });
    return { sql, counts, state, postgresClient: vi.fn(() => sql) };
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

describe("SQLite importer source inspection", () => {
    it("opens a read-only SQLite backup and resolves its canonical path", async () => {
        const directory = mkdtempSync(resolve(tmpdir(), "basishacks-sqlite-import-"));
        temporaryDirectories.push(directory);
        const file = resolve(directory, "fixture.sqlite");
        const fixture = createSource("seasonal", file);
        fixture.close();

        const opened = await openSource(file);
        expect(opened.sourcePath).toBe(file);
        expect(opened.source.prepare("PRAGMA query_only").get()).toEqual({ query_only: 1 });
        expect(() => opened.source.exec("CREATE TABLE should_not_write (id INTEGER)")).toThrow();
        opened.source.close();

        class BunSqliteDouble {
            options: unknown;
            path: string;
            constructor(path: string, options: unknown) {
                this.path = path;
                this.options = options;
            }
            exec(statement: string) {
                expect(statement).toBe("PRAGMA query_only = ON");
            }
        }
        const bunLoader = vi.fn(async () => ({ Database: BunSqliteDouble }));
        const bunOpened = await openSource(file, {
            isBun: true,
            loadBunDatabase: bunLoader,
            loadBetterSqlite: () => {
                throw new Error("Bun must use bun:sqlite");
            },
        });
        expect(bunLoader).toHaveBeenCalledOnce();
        expect(bunOpened.source).toMatchObject({
            path: file,
            options: { readonly: true, create: false },
        });
        await expect(openSource(file, { isBun: true })).rejects.toThrow();
    });

    it("rejects absent and missing backup paths", async () => {
        vi.stubEnv("SQLITE_IMPORT_PATH", "");
        await expect(openSource()).rejects.toThrow("Set SQLITE_IMPORT_PATH");
        await expect(
            openSource(resolve(tmpdir(), "missing-basishacks-import.sqlite")),
        ).rejects.toThrow("SQLite import file does not exist");
    });

    it("lists tables, counts rows, returns rows and columns, and ignores SQLite internals", () => {
        const source = createSource();
        source.exec("CREATE TABLE __drizzle_migrations (id INTEGER)");
        const tables = sourceTables(source);
        expect(tables).toContain("hackathon");
        expect(tables).toContain("__drizzle_migrations");
        expect(tables).not.toContain("sqlite_autoindex_hackathon_1");
        expect(sourceColumns(source, "teams")).toEqual(["id", "season_id"]);
        expect(countSourceRows(source, "hackathon")).toBe(1);
        expect(rowsFromSource(source, "hackathon")).toHaveLength(1);
        source.close();
    });

    it("allows recognized and metadata tables but rejects every unmapped source table", () => {
        expect(validateSourceTables(new Set(["users", "_cf_METADATA"]))).toEqual(["_cf_METADATA"]);
        expect(() => validateSourceTables(new Set(["mystery_records"]))).toThrow(
            "unrecognized non-metadata table(s): mystery_records",
        );
    });

    it("validates the seasonal source and reports source counts and archive mappings", () => {
        const source = createSource();
        source.exec(
            "UPDATE users SET role = 'judge', age = 16, login_code = 'one-time', login_expiry = 10 WHERE id = 7",
        );
        source.exec(`
            CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT, field3 TEXT, field4 TEXT, field5 TEXT);
            INSERT INTO judge_scores_migrate VALUES ('id', 'team_id', 'judge_user_id', 'scores', 'reasoning');
            INSERT INTO judge_scores_migrate VALUES ('legacy-1', '2', '7', '{}', 'old comment');
        `);
        const tables = sourceTables(source);
        const info = validateSource(source, tables);
        expect(info.seasonSchema).toBe("seasonal");
        expect(info.counts).toMatchObject({ hackathon: 1, seasons: 1, users: 1 });
        expect(info.targetCountExpectations.seasons).toBe(1);
        expect(info.metadataTables).toEqual([]);
        expect(info.legacyJudgeRows).toMatchObject({ sourceCount: 2, headerCount: 1 });
        expect(info.legacyJudgeRows.rows[0].field1).toBe("legacy-1");
        expect(info.legacyColumnRows).toEqual([
            { table_name: "users", row_key: "7", payload: { role: "judge", age: 16 } },
        ]);
        source.close();
    });

    it("normalizes seasonal epoch timestamps stored as zero-fraction strings", () => {
        const source = createSource();
        source.exec(`
            UPDATE seasons SET
                start_timestamp = '1780149600000.0',
                end_timestamp = '1780581600000.0',
                voting_start_timestamp = '1780840800000.0',
                voting_end_timestamp = '1781186400000.0',
                results_open_timestamp = '1785592800000.0'
            WHERE id = 1;
        `);

        const info = validateSource(source, sourceTables(source));

        expect(info.seasons[0]).toMatchObject({
            start_timestamp: 1780149600000,
            end_timestamp: 1780581600000,
            voting_start_timestamp: 1780840800000,
            voting_end_timestamp: 1781186400000,
            results_open_timestamp: 1785592800000,
        });
        source.close();
    });

    it("maps a legacy single-hackathon source to season one and validates timestamp forms", () => {
        const source = createSource("legacy");
        const info = validateSource(source, sourceTables(source));
        expect(info.seasonSchema).toBe("single-hackathon");
        expect(info.seasons).toMatchObject([
            { id: 1, name: "Imported legacy season", is_active: 1 },
        ]);
        expect(info.hackathonRows[0].start_timestamp).toBe(Date.parse("2026-05-01T00:00:00Z"));
        expect(info.targetCountExpectations.seasons).toBe(1);
        expect(normalizeLegacyTimestamp(10, "start_timestamp")).toBe(10);
        expect(normalizeLegacyTimestamp("-10", "start_timestamp")).toBe(-10);
        expect(normalizeLegacyTimestamp("1780149600000.0", "start_timestamp")).toBe(1780149600000);
        expect(normalizeLegacyTimestamp("2026-01-01T00:00:00Z", "start_timestamp")).toBe(
            Date.parse("2026-01-01T00:00:00Z"),
        );
        expect(makeLegacySeason({ status: "finished" })).toMatchObject({
            id: 1,
            status: "finished",
            score_curve_preset: "original",
            rubric_version_id: null,
        });
        source.close();
    });

    it("rejects invalid timestamps, partial schemas, missing tables, bad hackathon rows, and active-season ambiguity", () => {
        expect(() => normalizeLegacyTimestamp(undefined, "start_timestamp")).toThrow(
            "missing or invalid",
        );
        expect(() => normalizeLegacyTimestamp(" ", "start_timestamp")).toThrow(
            "missing or invalid",
        );
        expect(() =>
            normalizeLegacyTimestamp(Number.MAX_SAFE_INTEGER + 1, "start_timestamp"),
        ).toThrow("missing or invalid");
        expect(() => normalizeLegacyTimestamp("9007199254740992", "start_timestamp")).toThrow(
            "valid epoch millisecond value or ISO date",
        );
        expect(() => normalizeLegacyTimestamp("1780149600000.5", "start_timestamp")).toThrow(
            "valid epoch millisecond value or ISO date",
        );
        expect(() => normalizeLegacyTimestamp("not-a-date", "start_timestamp")).toThrow(
            "valid epoch millisecond value or ISO date",
        );
        expect(() => normalizeLegacyHackathonRow({ start_timestamp: 1 })).toThrow(
            "missing end_timestamp",
        );

        const partial = createSource("legacy");
        partial.exec("ALTER TABLE teams ADD COLUMN season_id INTEGER");
        expect(() => detectSeasonSchema(partial, sourceTables(partial))).toThrow(
            "partial season schema",
        );
        partial.close();

        const seasonalPartial = createSource();
        seasonalPartial.exec("ALTER TABLE team_scores DROP COLUMN season_id");
        expect(() => validateSource(seasonalPartial, sourceTables(seasonalPartial))).toThrow(
            "a seasons table requires season_id",
        );
        seasonalPartial.close();

        const emptySeasons = createSource();
        emptySeasons.exec("DELETE FROM seasons");
        expect(() => validateSource(emptySeasons, sourceTables(emptySeasons))).toThrow(
            "seasons table but no seasons",
        );
        emptySeasons.close();

        const missing = createSource();
        expect(() =>
            validateSource(missing, new Set(["hackathon", "teams", "team_scores"])),
        ).toThrow("missing required table: users");
        missing.close();

        const duplicateHackathon = createSource();
        duplicateHackathon.exec("INSERT INTO hackathon (id, status) VALUES (2, 'finished')");
        expect(() => validateSource(duplicateHackathon, sourceTables(duplicateHackathon))).toThrow(
            "exactly the canonical hackathon row",
        );
        duplicateHackathon.close();

        const twoActive = createSource();
        twoActive.exec(
            "INSERT INTO seasons (id, name, is_active, status) VALUES (2, 'Second', 1, 'finished')",
        );
        expect(() => validateSource(twoActive, sourceTables(twoActive))).toThrow(
            "more than one active season",
        );
        twoActive.close();
    });

    it("rejects broken relationships and preserves strict legacy score artifact validation", () => {
        const orphaned = createSource();
        orphaned.exec("INSERT INTO teams (id, season_id) VALUES (4, 99)");
        expect(() => validateSource(orphaned, sourceTables(orphaned))).toThrow(
            "broken relationships",
        );
        expect(checkSourceRelationships(orphaned, sourceTables(orphaned))).toContain(
            "teams.season_id has 1 orphan row(s)",
        );
        orphaned.close();

        const malformed = createSource();
        malformed.exec("CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT)");
        expect(() => prepareLegacyJudgeRows(malformed, sourceTables(malformed))).toThrow(
            "unexpected schema",
        );
        malformed.close();

        const duplicateHeader = createSource();
        duplicateHeader.exec(`
            CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT, field3 TEXT, field4 TEXT, field5 TEXT);
            INSERT INTO judge_scores_migrate VALUES ('id', 'team_id', 'judge_user_id', 'scores', 'reasoning');
            INSERT INTO judge_scores_migrate VALUES ('id', 'team_id', 'judge_user_id', 'scores', 'reasoning');
        `);
        expect(() =>
            prepareLegacyJudgeRows(duplicateHeader, sourceTables(duplicateHeader)),
        ).toThrow("duplicate header rows");
        duplicateHeader.close();

        const duplicateKeys = createSource();
        duplicateKeys.exec(`
            CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT, field3 TEXT, field4 TEXT, field5 TEXT);
            INSERT INTO judge_scores_migrate VALUES ('same', '1', '2', '{}', 'a');
            INSERT INTO judge_scores_migrate VALUES ('same', '1', '2', '{}', 'b');
        `);
        expect(() => prepareLegacyJudgeRows(duplicateKeys, sourceTables(duplicateKeys))).toThrow(
            "missing or duplicate legacy row key",
        );
        duplicateKeys.close();

        const blankKey = createSource();
        blankKey.exec(`
            CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT, field3 TEXT, field4 TEXT, field5 TEXT);
            INSERT INTO judge_scores_migrate VALUES (NULL, '1', '2', '{}', 'null key');
            INSERT INTO judge_scores_migrate VALUES (' ', '1', '2', '{}', 'blank key');
        `);
        expect(() => prepareLegacyJudgeRows(blankKey, sourceTables(blankKey))).toThrow(
            "missing or duplicate legacy row key",
        );
        blankKey.close();

        const missingKey = createSource();
        expect(prepareLegacyJudgeRows(missingKey, sourceTables(missingKey))).toMatchObject({
            rows: [],
            sourceCount: 0,
            headerCount: 0,
        });
        // The importer archives only explicitly listed columns and requires the stable application key.
        missingKey.exec(
            "CREATE TABLE oauth2_applications (owner_id INTEGER, proxy_microsoft INTEGER)",
        );
        expect(() => prepareLegacyColumnRows(missingKey, sourceTables(missingKey))).toThrow(
            "oauth2_applications is missing client_id",
        );
        missingKey.close();
    });

    it("archives team-score rows with missing references and still rejects other broken tables", () => {
        const source = createSource();
        source.exec(`
            INSERT INTO team_scores (team_id, judge_user_id, season_id, rubric_version_id)
            VALUES (404, 7, 1, 1), (3, 404, 1, 1), (405, 405, 1, 1);
        `);
        const available = sourceTables(source);
        const classified = classifyOrphanedTeamScores(source, available);
        expect(classified).toMatchObject({
            importableRowCount: 1,
            byRelationship: {
                "team_scores.team_id": 2,
                "team_scores.judge_user_id": 2,
            },
        });
        expect(classified.rows).toHaveLength(3);
        expect(new Set(classified.rows.map((row) => row.row_key)).size).toBe(3);
        expect(classified.rows[0]).toMatchObject({
            table_name: "team_scores",
            row_key: expect.stringMatching(/^rowid:/),
            payload: {
                source: "sqlite",
                source_table: "team_scores",
                source_row_key: expect.stringMatching(/^rowid:/),
                orphaned_relationships: ["team_scores.team_id"],
                row: { team_id: 404, judge_user_id: 7, season_id: 1, rubric_version_id: 1 },
            },
        });
        expect(classified.rows[2].payload.orphaned_relationships).toEqual([
            "team_scores.team_id",
            "team_scores.judge_user_id",
        ]);
        expect(classifyOrphanedTeamScores(source, new Set()).rows).toEqual([]);
        expect(classifyOrphanedTeamScores(source, new Set(["users"]))).toMatchObject({
            rows: [],
            byRelationship: {},
            importableRowCount: 0,
        });

        const sourceInfo = validateSource(source, available);
        expect(sourceInfo.targetCountExpectations.team_scores).toBe(1);
        expect(
            checkSourceRelationships(source, available, { excludeChildTables: ["team_scores"] }),
        ).toEqual([]);
        source.close();

        const scoreAndTeamOrphans = createSource();
        scoreAndTeamOrphans.exec(`
            INSERT INTO team_scores (team_id, judge_user_id, season_id, rubric_version_id)
            VALUES (404, 7, 1, 1);
            INSERT INTO teams (id, season_id) VALUES (4, 99);
        `);
        expect(() =>
            validateSource(scoreAndTeamOrphans, sourceTables(scoreAndTeamOrphans)),
        ).toThrow("teams.season_id has 1 orphan row(s)");
        scoreAndTeamOrphans.close();
    });

    it("uses a declared primary key when a SQLite score table has no rowid", () => {
        const source = createSource();
        source.exec(`
            DROP TABLE team_scores;
            CREATE TABLE team_scores (
                team_id INTEGER NOT NULL,
                judge_user_id INTEGER NOT NULL,
                season_id INTEGER,
                rubric_version_id INTEGER,
                PRIMARY KEY (team_id, judge_user_id)
            ) WITHOUT ROWID;
            INSERT INTO team_scores VALUES (404, 7, 1, 1);
        `);
        const classified = classifyOrphanedTeamScores(source, sourceTables(source));
        expect(classified.rows).toMatchObject([
            {
                row_key: "primary-key:[404,7]",
                payload: {
                    source_row_key: "primary-key:[404,7]",
                    orphaned_relationships: ["team_scores.team_id"],
                    row: { team_id: 404, judge_user_id: 7, season_id: 1, rubric_version_id: 1 },
                },
            },
        ]);
        source.close();
    });

    it("uses an unshadowed hidden row identifier when a source column is named rowid", () => {
        const source = createSource();
        source.exec(`
            ALTER TABLE team_scores ADD COLUMN rowid TEXT;
            INSERT INTO team_scores (team_id, judge_user_id, season_id, rubric_version_id, rowid)
            VALUES (404, 7, 1, 1, 'source-value');
        `);
        const classified = classifyOrphanedTeamScores(source, sourceTables(source));
        expect(classified.rows[0]).toMatchObject({
            row_key: "rowid:2",
            payload: {
                row: {
                    team_id: 404,
                    judge_user_id: 7,
                    season_id: 1,
                    rubric_version_id: 1,
                    rowid: "source-value",
                },
            },
        });
        source.close();
    });

    it("refuses ambiguous SQLite score rows when neither rowid nor a primary key exists", () => {
        const source = {
            prepare: (statement: string) => {
                if (statement.includes("rowid AS")) {
                    return {
                        all: () => {
                            throw new Error("no such column: rowid");
                        },
                    };
                }
                if (statement.startsWith("PRAGMA table_info")) return { all: () => [] };
                return { all: () => [{ team_id: 4 }], get: () => ({ count: 1 }) };
            },
        } as unknown as Database.Database;
        expect(() => classifyOrphanedTeamScores(source, new Set(["team_scores"]))).toThrow(
            "has no rowid or primary key",
        );
    });

    it("checks all declared relationships and skips pairs whose source columns are absent", () => {
        const allTables = new Set(
            DATABASE_FOREIGN_KEYS.flatMap(([child, , parent]) => [child, parent]),
        );
        const columnMap = new Map<string, Set<string>>();
        for (const [child, childColumn, parent, parentColumn] of DATABASE_FOREIGN_KEYS) {
            columnMap.set(child, new Set([...(columnMap.get(child) ?? []), childColumn]));
            columnMap.set(parent, new Set([...(columnMap.get(parent) ?? []), parentColumn]));
        }
        const source = {
            prepare: (statement: string) =>
                statement.startsWith("PRAGMA table_info")
                    ? {
                          all: () => {
                              const table = statement
                                  .match(/\(([^)]+)\)/)?.[1]
                                  ?.replaceAll('"', "");
                              return [...(columnMap.get(table ?? "") ?? [])].map((name) => ({
                                  name,
                              }));
                          },
                      }
                    : { get: () => ({ count: 0 }) },
        };
        expect(checkSourceRelationships(source, allTables)).toEqual([]);
        expect(
            checkSourceRelationships(
                { prepare: () => ({ all: () => [], get: () => ({ count: 99 }) }) },
                allTables,
            ),
        ).toEqual([]);
    });
});

describe("SQLite importer PostgreSQL validation and writes", () => {
    it("validates database URLs and target column metadata", async () => {
        expect(requireDatabaseUrl("postgres://user@localhost/db")).toBe(
            "postgres://user@localhost/db",
        );
        expect(requireDatabaseUrl("postgresql://user@localhost/db")).toContain("postgresql://");
        expect(() => requireDatabaseUrl("")).toThrow(
            "DATABASE_URL must point to the empty PostgreSQL target",
        );
        expect(() => requireDatabaseUrl("not a url")).toThrow("valid PostgreSQL connection URL");
        expect(() => requireDatabaseUrl("https://example.invalid/db")).toThrow(
            "must use postgres://",
        );

        const sql = vi.fn(async () => [{ column_name: "id", data_type: "integer" }]);
        expect(await getTargetColumns(sql, "teams")).toEqual(
            new Map([["id", { column_name: "id", data_type: "integer" }]]),
        );
        await expect(
            getTargetColumns(
                vi.fn(async () => []),
                "missing_table",
            ),
        ).rejects.toThrow("PostgreSQL table is missing: missing_table");
        expect(await targetRows({ unsafe: vi.fn(async () => [{ count: "3" }]) }, "teams")).toBe(3);
        expect(
            await targetRows({ unsafe: vi.fn(async () => [{ count: undefined }]) }, "teams"),
        ).toBe(0);
    });

    it("only allows an empty target and validates source-to-target field mappings", async () => {
        const source = createSource();
        const columns = targetColumns(source);
        const emptySql: any = async () => [];
        emptySql.unsafe = vi.fn(async () => [{ count: 0 }]);
        expect(await ensureEmptyTarget(emptySql, columns)).toMatchObject({
            hackathonId: undefined,
            rubricSeed: undefined,
        });

        const populatedSql: any = async () => [];
        populatedSql.unsafe = vi.fn(async (statement: string) => {
            if (statement.includes("count(*)")) return [{ count: 1 }];
            if (statement.includes('SELECT * FROM "hackathon"')) return [{ id: 2 }];
            return [];
        });
        await expect(ensureEmptyTarget(populatedSql, columns)).rejects.toThrow(
            "outside the exact fresh-migration seed state",
        );

        const missingColumnTarget = targetColumns(source);
        missingColumnTarget.get("teams")?.delete("unmapped_field");
        await expect(
            ensureEmptyTarget(
                emptySql,
                missingColumnTarget,
                new Map([["teams", ["unmapped_field"]]]),
            ),
        ).rejects.toThrow("SQLite field teams.unmapped_field has no PostgreSQL destination");

        const archivedColumnTarget = targetColumns(source);
        archivedColumnTarget.get("users")?.delete("role");
        const archivedSourceColumns = new Map([["users", ["role", "login_code", "login_expiry"]]]);
        await expect(
            ensureEmptyTarget(emptySql, archivedColumnTarget, archivedSourceColumns),
        ).resolves.toMatchObject({
            hackathonId: undefined,
        });
        source.close();
    });

    it("writes JSON values, override columns, batches, archive rows, and rubric version pointers", async () => {
        const statements: Array<{ statement: string; params: unknown[] }> = [];
        const sql: any = vi.fn(async (parts: TemplateStringsArray) => {
            statements.push({ statement: parts.join("?"), params: [] });
            return [{ id: 19 }];
        });
        sql.unsafe = vi.fn(async (statement: string, params: unknown[]) => {
            statements.push({ statement, params });
        });
        sql.json = (value: unknown) => value;
        const columns = new Map([
            ["scores", { data_type: "jsonb" }],
            ["name", { data_type: "text" }],
            ["season_id", { data_type: "integer" }],
        ]);
        expect(await insertRows(sql, "teams", [], new Map([["teams", columns]]))).toBe(0);
        expect(
            await insertRows(
                sql,
                "teams",
                [{ scores: { impact: 5 }, name: "Fixture" }],
                new Map([["teams", columns]]),
                () => ({ season_id: 1 }),
            ),
        ).toBe(1);
        expect(statements.at(-1)?.statement).toContain('INSERT INTO "teams"');
        expect(statements.at(-1)?.statement).toContain("::jsonb");
        expect(statements.at(-1)?.params).toEqual([JSON.stringify({ impact: 5 }), "Fixture", 1]);
        await expect(
            insertRows(
                sql,
                "teams",
                [{ name: "Fixture" }],
                new Map([["teams", new Map([["name", {}]])]]),
                () => ({ missing: 1 }),
            ),
        ).rejects.toThrow("table teams is missing required column missing");

        const batchRows = Array.from({ length: 8001 }, (_, index) => ({ name: `row-${index}` }));
        const beforeBatches = sql.unsafe.mock.calls.length;
        await insertRows(sql, "teams", batchRows, new Map([["teams", columns]]));
        expect(sql.unsafe.mock.calls.length - beforeBatches).toBe(2);

        expect(await insertLegacyArchive(sql, [])).toBe(0);
        expect(
            await insertLegacyArchive(sql, [
                { table_name: "users", row_key: "8", payload: { role: "judge" } },
            ]),
        ).toBe(1);
        expect(sql.unsafe.mock.calls.at(-1)?.[0]).toContain("INSERT INTO sqlite_legacy_data");

        const rubricSql: any = async () => [{ id: 11 }];
        rubricSql.json = (value: unknown) => value;
        const rubricVersions = await insertRubricVersions(rubricSql, [{ id: 4 }]);
        expect(rubricVersions.get(4)).toBe(11);
        expect(await insertRubricVersions(rubricSql, [])).toEqual(new Map());
    });

    it("chunks large archive imports below PostgreSQL's bind parameter limit", async () => {
        const unsafe = vi.fn(async () => undefined);
        const sql = Object.assign(vi.fn(), { unsafe });
        const rows = Array.from({ length: 22_000 }, (_, index) => ({
            table_name: "team_scores",
            row_key: String(index),
            payload: { team_id: index },
        }));

        await expect(insertLegacyArchive(sql as never, rows)).resolves.toBe(rows.length);

        expect(unsafe).toHaveBeenCalledTimes(2);
        expect(unsafe.mock.calls.map(([, params]) => params.length)).toEqual([60_000, 6_000]);
        expect(Math.max(...unsafe.mock.calls.map(([, params]) => params.length))).toBeLessThan(
            65_535,
        );
    });

    it("maps score seasons, verifies source relationships and checks every target foreign key", async () => {
        expect(importSeasonForScore({ season_id: 7 }, new Map(), 4)).toBe(7);
        expect(importSeasonForScore({ team_id: 2 }, new Map([[2, 8]]), 4)).toBe(8);
        expect(importSeasonForScore({ team_id: 2 }, new Map(), 4)).toBe(4);
        expect(importSeasonForScore({}, new Map(), undefined)).toBe(1);

        const relationSql = {
            unsafe: vi.fn(async () => [{ count: 0 }]),
        };
        await expect(validateTargetRelationships(relationSql)).resolves.toBeUndefined();
        relationSql.unsafe.mockImplementationOnce(async () => [{ count: 2 }]);
        await expect(validateTargetRelationships(relationSql)).rejects.toThrow(
            "has 2 orphan row(s)",
        );

        const foreignKeys = DATABASE_FOREIGN_KEYS.map(
            ([table_name, column_name, foreign_table_name, foreign_column_name]) => ({
                table_name,
                column_name,
                foreign_table_name,
                foreign_column_name,
            }),
        );
        await expect(validateTargetForeignKeys(async () => foreignKeys)).resolves.toBeUndefined();
        await expect(validateTargetForeignKeys(async () => [])).rejects.toThrow(
            "PostgreSQL schema is missing required foreign keys",
        );

        const sequenceSql = { unsafe: vi.fn(async () => []) };
        await setIdentitySequences(sequenceSql);
        expect(sequenceSql.unsafe).toHaveBeenCalledTimes(7);
    });

    it("imports the checked SQLite fixture transactionally with mocked PostgreSQL only", async () => {
        const source = createSource();
        source.exec("ALTER TABLE teams ADD COLUMN sourcing TEXT; UPDATE teams SET sourcing = NULL");
        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);
        sourceInfo.sourcePath = "verified-fixture.sqlite";
        const fake = createPostgresDouble(source);

        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgresql://fixture@localhost/fixture",
                postgresClient: fake.postgresClient,
                logger: { log: vi.fn() } as unknown as Console,
            }),
        ).resolves.toBeUndefined();
        expect(fake.postgresClient).toHaveBeenCalledWith(
            "postgresql://fixture@localhost/fixture",
            expect.objectContaining({ max: 1, prepare: false }),
        );
        expect(fake.sql.begin).toHaveBeenCalledOnce();
        expect(fake.sql.end).toHaveBeenCalledWith({ timeout: 5 });
        expect(fake.counts.seasons).toBe(1);
        expect(fake.counts.hackathon).toBe(1);
        const teamInsert = fake.sql.unsafe.mock.calls.find(([statement]) =>
            statement.startsWith('INSERT INTO "teams"'),
        );
        expect(teamInsert?.[1]).toEqual([3, 1, ""]);
        source.close();
    });

    it("imports legacy single-hackathon scores and archives discarded legacy artifacts", async () => {
        const source = createSource("legacy");
        source.exec("UPDATE users SET role = 'judge', age = 16 WHERE id = 7");
        source.exec(`
            CREATE TABLE judge_scores_migrate (field1 TEXT, field2 TEXT, field3 TEXT, field4 TEXT, field5 TEXT);
            INSERT INTO judge_scores_migrate VALUES ('legacy-id', '3', '7', '{}', 'archived comment');
        `);
        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);
        const fake = createPostgresDouble(source);
        const logger = { log: vi.fn() };

        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: fake.postgresClient,
                logger: logger as unknown as Console,
            }),
        ).resolves.toBeUndefined();
        expect(fake.counts.seasons).toBe(1);
        expect(fake.counts.team_scores).toBe(1);
        expect(fake.counts.sqlite_legacy_data).toBe(2);
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"legacySeasonMapping"'));
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"archivedDataRows": 1'));
        source.close();
    });

    it("imports only linked team scores and archives each orphan row with its source values", async () => {
        const source = createSource();
        source.exec(`
            INSERT INTO team_scores (team_id, judge_user_id, season_id, rubric_version_id)
            VALUES (404, 7, 1, 1), (3, 404, 1, 1);
        `);
        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);
        const fake = createPostgresDouble(source);
        const logger = { log: vi.fn() };

        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: fake.postgresClient,
                logger: logger as unknown as Console,
            }),
        ).resolves.toBeUndefined();

        expect(fake.counts.team_scores).toBe(1);
        expect(fake.counts.sqlite_legacy_data).toBe(3);
        const archiveCall = fake.sql.unsafe.mock.calls.find(([statement]: [string]) =>
            statement.startsWith("INSERT INTO sqlite_legacy_data"),
        );
        const archiveParams = archiveCall?.[1] as unknown[];
        const archivedRows = Array.from({ length: archiveParams.length / 3 }, (_, index) => {
            const offset = index * 3;
            return {
                tableName: archiveParams[offset],
                rowKey: archiveParams[offset + 1],
                payload: JSON.parse(String(archiveParams[offset + 2])),
            };
        });
        expect(archivedRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    tableName: "team_scores",
                    payload: expect.objectContaining({
                        source_table: "team_scores",
                        orphaned_relationships: ["team_scores.team_id"],
                        row: { team_id: 404, judge_user_id: 7, season_id: 1, rubric_version_id: 1 },
                    }),
                }),
                expect.objectContaining({
                    tableName: "team_scores",
                    payload: expect.objectContaining({
                        source_table: "team_scores",
                        orphaned_relationships: ["team_scores.judge_user_id"],
                        row: { team_id: 3, judge_user_id: 404, season_id: 1, rubric_version_id: 1 },
                    }),
                }),
            ]),
        );
        const archivedScoreRows = archivedRows.filter(
            ({ tableName }) => tableName === "team_scores",
        );
        expect(archivedScoreRows).toHaveLength(2);
        expect(new Set(archivedRows.map(({ rowKey }) => rowKey)).size).toBe(3);
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"archivedOrphanRows": 2'));
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining(
                "source team_scores orphans are preserved in sqlite_legacy_data",
            ),
        );
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('"archivedOrphanTeamScoreRows": 2'),
        );
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('"archivedOrphanRowsByRelationship"'),
        );
        source.close();
    });

    it("uses the first historical season when there is no active season", async () => {
        const source = createSource();
        source.exec("UPDATE seasons SET is_active = 0 WHERE id = 1");
        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);
        const fake = createPostgresDouble(source);
        await importToPostgres(source, available, sourceInfo, {
            databaseUrl: "postgres://fixture@localhost/db",
            postgresClient: fake.postgresClient,
            logger: { log: vi.fn() } as unknown as Console,
        });
        expect(fake.counts.team_scores).toBe(1);
        source.close();
    });

    it("closes PostgreSQL after schema, target occupancy, and row-count failures", async () => {
        const source = createSource();
        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);

        const missingTableClient = vi.fn(() => {
            const sql: any = async () => [];
            sql.end = vi.fn(async () => undefined);
            return sql;
        });
        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: missingTableClient,
            }),
        ).rejects.toThrow("PostgreSQL table is missing: hackathon");
        expect(missingTableClient.mock.results[0]?.value.end).toHaveBeenCalledOnce();

        const occupied = createPostgresDouble(source, { populated: true });
        occupied.sql.unsafe.mockImplementation(async (statement: string) => {
            if (statement.includes("count(*)"))
                return [{ count: statement.includes('"hackathon"') ? 1 : 0 }];
            if (statement.includes('SELECT * FROM "hackathon"')) return [{ id: 9 }];
            return [];
        });
        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: occupied.postgresClient,
            }),
        ).rejects.toThrow("outside the exact fresh-migration seed state");
        expect(occupied.sql.end).toHaveBeenCalledOnce();

        const mismatch = createPostgresDouble(source, { mismatch: true });
        await expect(
            importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: mismatch.postgresClient,
            }),
        ).rejects.toThrow("Row-count verification failed for hackathon");
        expect(mismatch.sql.end).toHaveBeenCalledOnce();

        const archiveMismatch = createPostgresDouble(source, { archiveMismatch: true });
        const withArchive = {
            ...sourceInfo,
            legacyColumnRows: [{ table_name: "users", row_key: "7", payload: {} }],
        };
        await expect(
            importToPostgres(source, available, withArchive, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: archiveMismatch.postgresClient,
                logger: { log: vi.fn() } as unknown as Console,
            }),
        ).rejects.toThrow("Legacy archive verification failed");
        expect(archiveMismatch.sql.end).toHaveBeenCalledOnce();

        const missingRubric = createPostgresDouble(source);
        await expect(
            importToPostgres(
                source,
                available,
                { ...sourceInfo, seasons: [] },
                {
                    databaseUrl: "postgres://fixture@localhost/db",
                    postgresClient: missingRubric.postgresClient,
                },
            ),
        ).rejects.toThrow("No imported rubric version exists for team_scores season 1");
        expect(missingRubric.sql.end).toHaveBeenCalledOnce();
        source.close();
    });
});

describe("SQLite importer command entry", () => {
    it("runs check-only with a source opener and never contacts PostgreSQL", async () => {
        const source = createSource();
        const sourceOpener = vi.fn(async () => ({ source, sourcePath: "checked.sqlite" }));
        const logger = { log: vi.fn(), error: vi.fn() };
        const postgresClient = vi.fn();

        await main({
            argv: ["node", "import-sqlite-to-postgres.mjs", "--check-only"],
            env: { SQLITE_IMPORT_PATH: "checked.sqlite" },
            sourceOpener,
            postgresClient,
            logger: logger as unknown as Console,
        });

        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining("PostgreSQL was not contacted"),
        );
        expect(postgresClient).not.toHaveBeenCalled();
        expect(sourceOpener).toHaveBeenCalledWith("checked.sqlite");
        expect(source.open).toBe(false);
    });

    it("checks legacy sources without mutating them and labels the fallback season", async () => {
        const source = createSource("legacy");
        const logger = { log: vi.fn() };
        await main({
            argv: ["node", "importer", "--check-only"],
            env: {},
            sourceOpener: async () => ({ source, sourcePath: "legacy.sqlite" }),
            logger: logger as unknown as Console,
        });
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"legacySeasonMapping"'));
        expect(source.open).toBe(false);
    });

    it("requires an explicit command and rejects conflicting flags before opening SQLite", async () => {
        const sourceOpener = vi.fn();
        await expect(main({ argv: ["node", "importer"], sourceOpener })).rejects.toThrow(
            "pass --confirm to perform the import",
        );
        await expect(
            main({ argv: ["node", "importer", "--confirm", "--check-only"], sourceOpener }),
        ).rejects.toThrow("Choose either --check-only or --confirm");
        expect(sourceOpener).not.toHaveBeenCalled();
    });

    it("closes SQLite when source validation or the PostgreSQL import fails", async () => {
        const invalid = createSource();
        invalid.exec("CREATE TABLE unreviewed_data (id INTEGER)");
        await expect(
            main({
                argv: ["node", "importer", "--check-only"],
                env: {},
                sourceOpener: async () => ({ source: invalid, sourcePath: "invalid.sqlite" }),
            }),
        ).rejects.toThrow("unrecognized non-metadata table");
        expect(invalid.open).toBe(false);

        const valid = createSource();
        const failingClient = vi.fn(() => {
            const sql: any = async () => [];
            sql.end = vi.fn(async () => undefined);
            return sql;
        });
        await expect(
            main({
                argv: ["node", "importer", "--confirm"],
                env: {
                    SQLITE_IMPORT_PATH: "valid.sqlite",
                    DATABASE_URL: "postgres://fixture@localhost/db",
                },
                sourceOpener: async () => ({ source: valid, sourcePath: "valid.sqlite" }),
                postgresClient: failingClient,
            }),
        ).rejects.toThrow("PostgreSQL table is missing: hackathon");
        expect(valid.open).toBe(false);
        valid.close();
    });

    it("reports Error and non-Error failures through the CLI handler", async () => {
        const logger = { log: vi.fn(), error: vi.fn() };
        const setExitCode = vi.fn();
        const errorResult = await runCli({
            argv: ["node", "importer"],
            logger: logger as unknown as Console,
            setExitCode,
        });
        expect(errorResult).toBe(false);
        expect(logger.error).toHaveBeenLastCalledWith(expect.stringContaining("pass --confirm"));
        expect(setExitCode).toHaveBeenCalledWith(1);

        const rawFailure = await runCli({
            argv: ["node", "importer", "--check-only"],
            sourceOpener: async () => {
                throw "open failed";
            },
            logger: logger as unknown as Console,
            setExitCode,
        });
        expect(rawFailure).toBe(false);
        expect(logger.error).toHaveBeenLastCalledWith("[SQLite import] open failed");
        expect(setExitCode).toHaveBeenCalledTimes(2);

        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        try {
            const defaultExit = await runCli({
                argv: ["node", "importer"],
                logger: logger as unknown as Console,
            });
            expect(defaultExit).toBe(false);
            expect(process.exitCode).toBe(1);
        } finally {
            process.exitCode = originalExitCode;
        }
    });

    it("executes the guarded CLI entrypoint against a temporary fixture", async () => {
        const directory = mkdtempSync(resolve(tmpdir(), "basishacks-sqlite-import-"));
        temporaryDirectories.push(directory);
        const file = resolve(directory, "entry.sqlite");
        const fixture = createSource("seasonal", file);
        fixture.close();
        const originalArgv = process.argv;
        const originalPath = process.env.SQLITE_IMPORT_PATH;
        process.argv = ["node", resolve("scripts/import-sqlite-to-postgres.mjs"), "--check-only"];
        process.env.SQLITE_IMPORT_PATH = file;
        const output = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
            await import("../../scripts/import-sqlite-to-postgres.mjs?entrypoint-test");
            expect(output).toHaveBeenCalledWith(expect.stringContaining("source checks passed"));
        } finally {
            process.argv = originalArgv;
            if (originalPath === undefined) delete process.env.SQLITE_IMPORT_PATH;
            else process.env.SQLITE_IMPORT_PATH = originalPath;
        }
    });

    it("imports the module without running its CLI when there is no argv path", async () => {
        const originalArgv = process.argv;
        process.argv = ["node"];
        try {
            await import("../../scripts/import-sqlite-to-postgres.mjs?no-entrypoint-test");
        } finally {
            process.argv = originalArgv;
        }
    });
});
