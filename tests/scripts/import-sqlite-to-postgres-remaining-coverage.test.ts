import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
    classifyOrphanedTeamScores,
    DATABASE_FOREIGN_KEYS,
    importToPostgres,
    sourceTables,
    validateSource,
} from "../../scripts/import-sqlite-to-postgres.mjs";
import { IMPORT_TARGET_TABLES } from "../../scripts/sqlite-import-target.mjs";

const availableRelations = new Set(["team_scores", "teams", "users", "seasons", "rubric_versions"]);

const createRelatedScoreSource = (teamSchema = "id INTEGER PRIMARY KEY") => {
    const source = new Database(":memory:");
    source.exec(`
        CREATE TABLE team_scores (
            team_id INTEGER,
            judge_user_id INTEGER,
            season_id INTEGER,
            rubric_version_id INTEGER
        );
        CREATE TABLE teams (${teamSchema});
        CREATE TABLE users (id INTEGER PRIMARY KEY);
        CREATE TABLE seasons (id INTEGER PRIMARY KEY);
        CREATE TABLE rubric_versions (id INTEGER PRIMARY KEY);
        INSERT INTO teams VALUES (${teamSchema.startsWith("id") ? "3" : "'fixture team'"});
        INSERT INTO users VALUES (7);
        INSERT INTO seasons VALUES (1);
        INSERT INTO rubric_versions VALUES (1);
    `);
    return source;
};

describe("SQLite importer remaining source-key coverage", () => {
    it("uses composite primary keys when every SQLite rowid alias is a real column", () => {
        const source = new Database(":memory:");
        source.exec(`
            CREATE TABLE team_scores (
                rowid TEXT,
                _rowid_ TEXT,
                oid TEXT,
                team_id INTEGER,
                judge_user_id INTEGER,
                PRIMARY KEY (team_id, judge_user_id)
            );
            INSERT INTO team_scores VALUES ('r', '_r', 'o', 3, 7);
        `);

        try {
            expect(classifyOrphanedTeamScores(source, new Set(["team_scores"]))).toEqual({
                rows: [],
                byRelationship: {},
                importableRowCount: 1,
            });
        } finally {
            source.close();
        }
    });

    it("falls back to the primary key when a rowid query reports that rowid is unavailable", () => {
        const source = {
            prepare(statement: string) {
                if (statement.includes("PRAGMA table_info")) {
                    return {
                        all: () => [
                            { name: "team_id", pk: 1 },
                            { name: "judge_user_id", pk: 2 },
                        ],
                    };
                }
                if (statement.includes('AS "__import_source_rowid__"')) {
                    return {
                        all: () => {
                            throw new Error("no such column: rowid");
                        },
                    };
                }
                if (statement.includes('SELECT * FROM "team_scores"')) {
                    return { all: () => [{ team_id: 3, judge_user_id: 7 }] };
                }
                throw new Error(`Unexpected SQLite query: ${statement}`);
            },
        };

        expect(classifyOrphanedTeamScores(source, new Set(["team_scores"]))).toEqual({
            rows: [],
            byRelationship: {},
            importableRowCount: 1,
        });
    });

    it("rethrows unrelated rowid query failures instead of masking source I/O errors", () => {
        const source = {
            prepare(statement: string) {
                if (statement.includes("PRAGMA table_info")) {
                    return { all: () => [{ name: "team_id", pk: 1 }] };
                }
                if (statement.includes('AS "__import_source_rowid__"')) {
                    return {
                        all: () => {
                            throw new Error("disk I/O error");
                        },
                    };
                }
                throw new Error(`Unexpected SQLite query: ${statement}`);
            },
        };

        expect(() => classifyOrphanedTeamScores(source, new Set(["team_scores"]))).toThrow(
            "disk I/O error",
        );
    });

    it("skips absent relationship columns and treats null nullable season references as valid", () => {
        const missingParentColumn = createRelatedScoreSource("name TEXT");
        missingParentColumn.exec("INSERT INTO team_scores VALUES (404, 7, 1, 1)");
        const nullableSeason = createRelatedScoreSource();
        nullableSeason.exec("INSERT INTO team_scores VALUES (3, 7, NULL, 1)");

        try {
            expect(
                classifyOrphanedTeamScores(missingParentColumn, availableRelations),
            ).toMatchObject({ importableRowCount: 1, rows: [] });
            expect(classifyOrphanedTeamScores(nullableSeason, availableRelations)).toMatchObject({
                importableRowCount: 1,
                rows: [],
            });
        } finally {
            missingParentColumn.close();
            nullableSeason.close();
        }
    });
});

describe("SQLite importer summary defaults", () => {
    it("uses zero for a missing team-score count in a synthetic import summary", async () => {
        const source = new Database(":memory:");
        source.exec(`
            CREATE TABLE hackathon (
                id INTEGER PRIMARY KEY, status TEXT, start_timestamp INTEGER,
                end_timestamp INTEGER, voting_start_timestamp INTEGER,
                voting_end_timestamp INTEGER, results_open_timestamp INTEGER
            );
            CREATE TABLE seasons (
                id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER, status TEXT,
                rubric_version_id INTEGER
            );
            CREATE TABLE teams (id INTEGER PRIMARY KEY, season_id INTEGER);
            CREATE TABLE users (id INTEGER PRIMARY KEY, team_id INTEGER);
            CREATE TABLE team_scores (
                team_id INTEGER, judge_user_id INTEGER, season_id INTEGER, rubric_version_id INTEGER
            );
            INSERT INTO hackathon VALUES (1, 'finished', 1, 2, 3, 4, 5);
            INSERT INTO seasons VALUES (1, 'Fixture', 1, 'finished', 1);
            INSERT INTO teams VALUES (3, 1);
            INSERT INTO users VALUES (7, NULL);
            INSERT INTO team_scores VALUES (3, 7, 1, 1);
        `);

        const available = sourceTables(source);
        const sourceInfo = validateSource(source, available);
        delete sourceInfo.counts.team_scores;

        const columnsByTable = new Map<string, Map<string, Record<string, unknown>>>();
        for (const table of IMPORT_TARGET_TABLES) {
            let columns = ["id"];
            if (table === "hackathon") {
                columns = [
                    "id",
                    "status",
                    "start_timestamp",
                    "end_timestamp",
                    "voting_start_timestamp",
                    "voting_end_timestamp",
                    "results_open_timestamp",
                ];
            } else if (table === "seasons") {
                columns = ["id", "name", "is_active", "status", "rubric_version_id"];
            } else if (table === "teams") columns = ["id", "season_id", "sourcing"];
            else if (table === "users") columns = ["id", "team_id"];
            else if (table === "team_scores") {
                columns = ["team_id", "judge_user_id", "season_id", "rubric_version_id"];
            } else if (table === "rubric_versions") {
                columns = [
                    "id",
                    "season_id",
                    "version",
                    "name",
                    "definition",
                    "source_template_id",
                    "created_by",
                ];
            } else if (table === "rubric_templates") {
                columns = ["id", "name", "description", "definition", "created_by"];
            } else if (table === "sqlite_legacy_data") {
                columns = ["table_name", "row_key", "payload"];
            }
            columnsByTable.set(
                table,
                new Map(
                    columns.map((column) => [
                        column,
                        {
                            column_name: column,
                            data_type: ["definition", "payload"].includes(column)
                                ? "jsonb"
                                : "text",
                        },
                    ]),
                ),
            );
        }

        const counts = Object.fromEntries(IMPORT_TARGET_TABLES.map((table) => [table, 0]));
        const sql: any = async (parts: TemplateStringsArray, ...values: unknown[]) => {
            const statement = parts.join(" ").replace(/\s+/g, " ");
            if (statement.includes("information_schema.columns")) {
                return [...(columnsByTable.get(String(values[0]))?.values() ?? [])];
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
        sql.json = (value: unknown) => value;
        sql.unsafe = async (statement: string, params: unknown[] = []) => {
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
            if (statement.includes("count(*)::bigint AS count FROM ")) {
                if (/LEFT JOIN/.test(statement)) return [{ count: 0 }];
                const table = statement.match(/FROM "([^"]+)"/)?.[1];
                return [{ count: counts[table ?? ""] ?? 0 }];
            }
            const insert = statement.match(/INSERT INTO "([^"]+)" \(([^)]+)\) VALUES/);
            if (insert) {
                counts[insert[1]] += Math.floor(params.length / insert[2].split(",").length);
            }
            if (statement.startsWith("INSERT INTO sqlite_legacy_data")) {
                counts.sqlite_legacy_data += Math.floor(params.length / 3);
            }
            return [];
        };
        sql.begin = (run: (transaction: typeof sql) => Promise<void>) => run(sql);
        sql.end = async () => undefined;

        try {
            const logger = { log: vi.fn() };
            await importToPostgres(source, available, sourceInfo, {
                databaseUrl: "postgres://fixture@localhost/db",
                postgresClient: () => sql,
                logger: logger as unknown as Console,
            });

            expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"sourceRows": 0'));
        } finally {
            source.close();
        }
    });
});
