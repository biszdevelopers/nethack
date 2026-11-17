import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptUrl = new URL("../../scripts/audit-sqlite-postgres.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const projectRoot = dirname(dirname(scriptPath));
const modulePath = "../../scripts/audit-sqlite-postgres.mjs";
const importModulePath = "../../scripts/import-sqlite-to-postgres.mjs";

type Row = Record<string, any>;

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalEnv = {
    SQLITE_IMPORT_PATH: process.env.SQLITE_IMPORT_PATH,
    DATABASE_URL: process.env.DATABASE_URL,
};

const auditTables = [
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

const columnMap = (names: string[], jsonColumns: string[] = []) =>
    new Map<string, Row>(
        names.map((name) => [
            name,
            {
                column_name: name,
                data_type: jsonColumns.includes(name) ? "jsonb" : "text",
            },
        ]),
    );

function createSourceDouble(
    options: { primaryKeys?: Record<string, Row[]>; integrity?: Row | undefined } = {},
) {
    const primaryKeys = options.primaryKeys ?? {};
    const integrity = Object.hasOwn(options, "integrity")
        ? options.integrity
        : { integrity_check: "ok" };
    const prepare = vi.fn((statement: string) => {
        if (statement === "PRAGMA integrity_check") return { get: () => integrity };
        const table = statement.match(/^PRAGMA table_info\("(.*)"\)$/)?.[1];
        if (table === undefined) throw new Error(`Unexpected statement: ${statement}`);
        return { all: () => primaryKeys[table.replaceAll('""', '"')] ?? [] };
    });
    return { prepare, close: vi.fn() };
}

function createSqlDouble(
    options: {
        targetPrimaryKeys?: Record<string, string[]>;
        rows?: Record<string, Row[]>;
        archiveRows?: Row[];
    } = {},
) {
    const targetPrimaryKeys = options.targetPrimaryKeys ?? {};
    const rows = options.rows ?? {};
    const archiveRows = options.archiveRows ?? [];
    const sql: any = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const statement = parts.join("?");
        if (statement.includes("information_schema.table_constraints")) {
            return (targetPrimaryKeys[String(values[0])] ?? []).map((column_name) => ({
                column_name,
            }));
        }
        if (statement.includes("sqlite_legacy_data")) return archiveRows;
        return [];
    });
    sql.unsafe = vi.fn(async (statement: string) => {
        const table = statement.match(/^SELECT \* FROM "(.*)"$/)?.[1];
        return rows[table?.replaceAll('""', '"') ?? ""] ?? [];
    });
    sql.begin = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(sql));
    sql.end = vi.fn(async () => undefined);
    return sql;
}

interface ModuleOptions {
    source?: ReturnType<typeof createSourceDouble>;
    sql?: any;
    availableTables?: Set<string>;
    sourceInfo?: Row;
    rowsFromSource?: (tableName: string) => Row[];
    sourceColumns?: (tableName: string) => string[];
    openSource?: (sourcePath?: string) => Promise<{ source: unknown; sourcePath: string }>;
    requireDatabaseUrl?: (databaseUrl?: string) => string;
    getTargetColumns?: (tableName: string) => Promise<Map<string, Row>>;
    mkdir?: ReturnType<typeof vi.fn>;
    open?: ReturnType<typeof vi.fn>;
    argv1?: string;
    argv?: string[];
    env?: Record<string, string>;
}

async function loadAuditModule(options: ModuleOptions = {}) {
    vi.resetModules();
    const source = options.source ?? createSourceDouble();
    const sql = options.sql ?? createSqlDouble();
    const postgresClient = vi.fn(() => sql);
    const availableTables = options.availableTables ?? new Set<string>();
    const sourceInfo = options.sourceInfo ?? {};
    const rowsFromSource = options.rowsFromSource ?? (() => []);
    const sourceColumns = options.sourceColumns ?? (() => []);
    const openSource =
        options.openSource ?? (async () => ({ source, sourcePath: "/resolved/source.sqlite" }));
    const requireDatabaseUrl = options.requireDatabaseUrl ?? ((value?: string) => String(value));
    const getTargetColumns =
        options.getTargetColumns ??
        (async () => new Map([["id", { column_name: "id", data_type: "integer" }]]));
    const mkdir = options.mkdir ?? vi.fn(async () => undefined);
    const open =
        options.open ??
        vi.fn(async () => ({
            writeFile: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
        }));

    vi.doMock("node:fs/promises", () => ({ mkdir, open }));
    vi.doMock("postgres", () => ({ default: postgresClient }));
    vi.doMock(importModulePath, () => ({
        getTargetColumns: (_sql: unknown, tableName: string) => getTargetColumns(tableName),
        openSource: (sourcePath?: string) => openSource(sourcePath),
        requireDatabaseUrl,
        rowsFromSource: (_source: unknown, tableName: string) => rowsFromSource(tableName),
        sourceColumns: (_source: unknown, tableName: string) => sourceColumns(tableName),
        sourceTables: () => availableTables,
        validateSource: () => sourceInfo,
    }));

    for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;
    process.argv = [
        process.execPath,
        options.argv1 ?? "/not-the-audit-script.mjs",
        ...(options.argv ?? []),
    ];

    const module = await import(modulePath);
    return {
        module,
        source,
        sql,
        postgresClient,
        availableTables,
        sourceInfo,
        mkdir,
        open,
        getTargetColumns,
    };
}

afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
    }
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("postgres");
    vi.doUnmock(importModulePath);
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("audit reconciliation report", () => {
    it("compares every field and reports blanks, conflicts, missing rows, and archives", async () => {
        const sourceInfo: Row = {
            seasonSchema: "seasonal",
            sourcePath: "/snapshot/source.sqlite",
            counts: { teams: 5 },
            seasons: [{ id: 7, is_active: 1 }],
            hackathonRows: [{ id: 1, status: "finished" }],
            legacyColumnRows: [{}, {}],
            legacyJudgeRows: { rows: [{}] },
            orphanedTeamScores: { rows: [{}, {}] },
        };
        const source = createSourceDouble({
            primaryKeys: {
                hackathon: [{ pk: 1, name: "id" }],
                seasons: [{ pk: 1, name: "id" }],
                teams: [{ pk: 1, name: "id" }],
                peer_voting_scores: [{ pk: 1, name: "id" }],
                ballots: [{ pk: 1, name: "id" }],
            },
            integrity: undefined,
        });
        const columns: Record<string, Map<string, Row>> = {
            hackathon: columnMap(["id", "status"]),
            seasons: columnMap(["id", "name", "is_active"]),
            teams: columnMap(
                ["id", "name", "project_description", "scores", "metadata", "created_at"],
                ["scores", "metadata"],
            ),
            peer_voting_scores: columnMap(["id", "user_id", "season_id", "score"]),
        };
        const sourceRows: Record<string, Row[]> = {
            teams: [
                {
                    id: 1,
                    name: "",
                    project_description: null,
                    scores: '{"a":1}',
                    metadata: '{"z":1}',
                },
                {
                    id: 2,
                    name: "Beta",
                    project_description: "p",
                    scores: "not-json",
                    created_at: new Date("2026-01-02T00:00:00.000Z"),
                },
                { id: 3, name: "Gamma", project_description: "", scores: 7n },
                { id: 5, name: "   ", project_description: "", scores: 9n },
                {
                    id: 6,
                    name: "",
                    project_description: "",
                    scores: [1, { b: 2, a: 1 }],
                    created_at: new Date("2026-01-02T00:00:00.000Z"),
                },
            ],
            peer_voting_scores: [
                { id: 1, user_id: 2, score: 10 },
                { id: 2, user_id: 3, season_id: 4, score: 5 },
            ],
            ballots: [],
        };
        const targetRows: Record<string, Row[]> = {
            hackathon: [{ id: 1, status: "finished" }],
            seasons: [{ id: 1, name: "Season", is_active: 1 }],
            teams: [
                {
                    id: 1,
                    name: "Alpha",
                    project_description: null,
                    scores: { a: 1 },
                    metadata: { z: 1 },
                },
                {
                    id: 2,
                    name: "",
                    project_description: "p",
                    scores: "other",
                    created_at: "2026-01-02T00:00:00.000Z",
                },
                { id: 4, name: "Delta" },
                { id: 5, name: " ", project_description: "", scores: '"9"' },
                {
                    id: 6,
                    name: "",
                    project_description: "",
                    scores: [1, { a: 1, b: 2 }],
                    created_at: "2026-01-02T00:00:00.000Z",
                },
            ],
            peer_voting_scores: [
                { id: 1, user_id: 2, season_id: 7, score: 10 },
                { id: 2, user_id: 3, season_id: 4, score: 5 },
            ],
        };
        const availableTables = new Set([
            "hackathon",
            "seasons",
            "teams",
            "peer_voting_scores",
            "ballots",
        ]);
        const { module } = await loadAuditModule({
            source,
            sourceInfo,
            availableTables,
            rowsFromSource: (tableName) => sourceRows[tableName] ?? [],
            sourceColumns: (tableName) => [...(columns[tableName]?.keys() ?? [])],
        });
        const target = Object.fromEntries(
            Object.entries(targetRows).map(([tableName, rows]) => [
                tableName,
                {
                    rows,
                    columns: columns[tableName]!,
                    primaryKey: tableName === "peer_voting_scores" ? ["id", "season_id"] : ["id"],
                },
            ]),
        );

        const report = module.buildReconciliationReport({
            source,
            sourceInfo,
            sourceTables: availableTables,
            target,
        });

        expect(report.generatedAt).toEqual(expect.any(String));
        expect(report.sourcePath).toBe("/snapshot/source.sqlite");
        expect(report.sourceSeasonSchema).toBe("seasonal");
        expect(report.sourceCounts).toEqual({ teams: 5 });
        expect(report.sourceIntegrity).toBe("unknown");
        expect(report.archivedLegacyRows).toEqual({
            removedColumns: 2,
            legacyJudgeRows: 1,
            orphanedTeamScores: 2,
        });
        expect(report.postgresArchivedLegacyRows).toEqual({});
        expect(report.tables.ballots).toEqual({
            sourceRows: 0,
            postgresRows: null,
            status: "missing-postgres-table",
        });
        expect(report.tables.users).toBeUndefined();

        const teams = report.tables.teams;
        expect(teams).toMatchObject({
            sourceRows: 5,
            postgresRows: 5,
            sourceKey: ["id"],
            postgresKey: ["id"],
            status: "compared",
        });
        expect(teams.missingInPostgres).toEqual([{ key: [3] }]);
        expect(teams.missingFields).toEqual([{ key: [2], column: "name" }]);
        expect(teams.conflicts).toEqual([
            {
                key: [2],
                column: "scores",
                sqliteValue: "not-json",
                postgresValue: "other",
            },
        ]);
        expect(teams.postgresOnlyRows).toEqual([{ key: [4] }]);
        expect(teams.fieldPresence.name).toEqual({
            sourceNonBlankRows: 2,
            postgresNonBlankRows: 2,
            sourceBlankPostgresNonBlankRows: 1,
            sourceNonBlankPostgresBlankRows: 1,
        });
        expect(teams.fieldPresence.project_description).toEqual({
            sourceNonBlankRows: 1,
            postgresNonBlankRows: 1,
            sourceBlankPostgresNonBlankRows: 0,
            sourceNonBlankPostgresBlankRows: 0,
        });
        expect(teams.fieldPresence.scores).toEqual({
            sourceNonBlankRows: 5,
            postgresNonBlankRows: 4,
            sourceBlankPostgresNonBlankRows: 0,
            sourceNonBlankPostgresBlankRows: 0,
        });

        expect(report.tables.peer_voting_scores).toMatchObject({
            sourceKey: ["id", "season_id"],
            postgresKey: ["id", "season_id"],
            status: "compared",
        });
        expect(report.tables.peer_voting_scores.missingInPostgres).toEqual([]);
        expect(report.tables.peer_voting_scores.conflicts).toEqual([]);
        expect(report.tables.peer_voting_scores.postgresOnlyRows).toEqual([]);
        expect(report.tables.hackathon.status).toBe("compared");
        expect(report.tables.seasons.missingInPostgres).toEqual([{ key: [7] }]);
        expect(source.prepare).toHaveBeenCalledWith('PRAGMA table_info("teams")');
    });

    it("maps legacy seasons and reports manual key mappings with unknown columns", async () => {
        const source = createSourceDouble({
            primaryKeys: {
                users: [{ pk: 1, name: "id" }],
                awards: [
                    { pk: 0, name: "ghost" },
                    { pk: 2, name: "name" },
                    { pk: 1, name: "id" },
                ],
                team_awards: [{ pk: 1, name: "id" }],
            },
            integrity: { integrity_check: "ok" },
        });
        const baseInfo: Row = {
            seasonSchema: "single-hackathon",
            sourcePath: "/legacy.sqlite",
            counts: {},
            legacyColumnRows: [],
            legacyJudgeRows: { rows: [] },
            orphanedTeamScores: { rows: [] },
        };
        const rows: Record<string, Row[]> = {
            users: [{ id: 9, email: "a@example.test" }],
            awards: [{ id: 4, name: "Best" }],
            team_awards: [],
        };
        const { module } = await loadAuditModule({
            source,
            sourceInfo: baseInfo,
            availableTables: new Set(["users", "awards", "team_awards"]),
            rowsFromSource: (tableName) => rows[tableName] ?? [],
            sourceColumns: (tableName) =>
                tableName === "users"
                    ? ["id", "email"]
                    : tableName === "awards"
                      ? ["id", "name"]
                      : ["id"],
        });
        const target = {
            seasons: {
                rows: [{ id: 1, name: "Season" }],
                columns: columnMap(["id", "name"]),
                primaryKey: ["id"],
            },
            users: {
                rows: [{ email: "a@example.test" }],
                columns: columnMap(["email"]),
                primaryKey: ["email", "ghost"],
            },
            awards: {
                rows: [{ id: 4, name: "Best" }],
                columns: columnMap(["id", "name"]),
                primaryKey: ["name"],
            },
            team_awards: {
                rows: [{ id: 1 }],
                columns: columnMap(["id"]),
                primaryKey: ["id"],
            },
        };

        const emptyReport = module.buildReconciliationReport({
            source,
            sourceInfo: { ...baseInfo, seasons: [] },
            sourceTables: new Set(["users", "awards", "team_awards"]),
            target,
        });

        expect(emptyReport.sourceIntegrity).toBe("ok");
        expect(emptyReport.sourceSeasonSchema).toBe("single-hackathon");
        expect(emptyReport.tables.seasons).toMatchObject({
            sourceRows: 0,
            postgresRows: 1,
            sourceKey: ["id"],
            status: "compared",
        });
        expect(emptyReport.tables.seasons.postgresOnlyRows).toEqual([{ key: [1] }]);
        expect(emptyReport.tables.users).toMatchObject({
            sourceKey: ["id"],
            postgresKey: ["email", "ghost"],
            status: "manual-key-mapping-required",
        });
        expect(emptyReport.tables.awards).toMatchObject({
            sourceKey: ["id", "name"],
            postgresKey: ["name"],
            status: "manual-key-mapping-required",
        });
        expect(emptyReport.tables.team_awards.postgresOnlyRows).toEqual([{ key: [1] }]);
        expect(emptyReport.tables.teams).toBeUndefined();

        const legacyReport = module.buildReconciliationReport({
            source,
            sourceInfo: {
                ...baseInfo,
                seasons: [{ id: 1, name: "Legacy season", is_active: 1 }],
            },
            sourceTables: new Set(["users", "awards", "team_awards"]),
            target,
        });

        expect(legacyReport.tables.seasons).toMatchObject({
            sourceRows: 1,
            postgresRows: 1,
            sourceKey: ["id"],
            status: "compared",
        });
        expect(legacyReport.tables.seasons.missingInPostgres).toEqual([]);
        expect(source.prepare).toHaveBeenCalledWith('PRAGMA table_info("awards")');
    });

    it.each([
        {
            name: "active season",
            seasons: [
                { id: 4, is_active: 0 },
                { id: 7, is_active: 1 },
            ],
            expectedSeason: 7,
            primaryKey: ["id", "season_id"],
        },
        {
            name: "first season fallback",
            seasons: [{ id: 5, is_active: 0 }],
            expectedSeason: 5,
            primaryKey: ["id", "season_id"],
        },
        {
            name: "no seasons",
            seasons: [],
            expectedSeason: undefined,
            primaryKey: ["id"],
        },
    ])(
        "resolves peer voting season from $name",
        async ({ seasons, expectedSeason, primaryKey }) => {
            const sourceInfo: Row = {
                seasonSchema: "seasonal",
                sourcePath: "/peer.sqlite",
                counts: {},
                seasons,
                hackathonRows: [],
                legacyColumnRows: [],
                legacyJudgeRows: { rows: [] },
                orphanedTeamScores: { rows: [] },
            };
            const source = createSourceDouble({
                primaryKeys: { peer_voting_scores: [{ pk: 1, name: "id" }] },
            });
            const columns = columnMap(["id", "user_id", "season_id", "score"]);
            const targetRows =
                expectedSeason === undefined
                    ? [{ id: 1, user_id: 2, score: 5 }]
                    : [{ id: 1, user_id: 2, season_id: expectedSeason, score: 5 }];
            const { module } = await loadAuditModule({
                source,
                sourceInfo,
                availableTables: new Set(["peer_voting_scores"]),
                rowsFromSource: () => [{ id: 1, user_id: 2, score: 5 }],
                sourceColumns: () => ["id", "user_id", "score"],
            });

            const report = module.buildReconciliationReport({
                source,
                sourceInfo,
                sourceTables: new Set(["peer_voting_scores"]),
                target: {
                    peer_voting_scores: { rows: targetRows, columns, primaryKey },
                },
            });

            const result = report.tables.peer_voting_scores;
            expect(result.status).toBe("compared");
            expect(result.missingInPostgres).toEqual([]);
            expect(result.conflicts).toEqual([]);
            expect(result.postgresOnlyRows).toEqual([]);
        },
    );
});

describe("SQLite and PostgreSQL audit execution", () => {
    const buildFullFixture = () => {
        const columnsByTable: Record<string, Map<string, Row>> = {
            hackathon: columnMap(["id", "status"]),
            seasons: columnMap(["id"]),
            teams: columnMap(["id", "project_description"]),
            peer_voting_scores: columnMap(["id", "user_id", "season_id", "score"]),
        };
        const columnsFor = (tableName: string) => columnsByTable[tableName] ?? columnMap(["id"]);
        const sourceColumnNames: Record<string, string[]> = {
            hackathon: ["id", "status"],
            seasons: ["id"],
            teams: ["id", "project_description"],
            peer_voting_scores: ["id", "user_id", "score"],
        };
        const sourceRows: Record<string, Row[]> = {
            teams: [
                { id: 1, project_description: "" },
                { id: 2, project_description: "src" },
                { id: 3, project_description: "a" },
                { id: 9, project_description: "ghost" },
            ],
            peer_voting_scores: [{ id: 1, user_id: 2, score: 10 }],
        };
        const targetRows: Record<string, Row[]> = {
            hackathon: [{ id: 1, status: "finished" }],
            seasons: [{ id: 1 }],
            teams: [
                { id: 1, project_description: "tgt" },
                { id: 2, project_description: "" },
                { id: 3, project_description: "b" },
                { id: 4, project_description: "only" },
            ],
            peer_voting_scores: [{ id: 1, user_id: 2, season_id: 5, score: 10 }],
        };
        const sourceInfo: Row = {
            seasonSchema: "seasonal",
            sourcePath: "/fixture.sqlite",
            counts: {},
            seasons: [{ id: 5, is_active: 1 }],
            hackathonRows: [{ id: 1, status: "finished" }],
            legacyColumnRows: [],
            legacyJudgeRows: { rows: [] },
            orphanedTeamScores: { rows: [] },
        };
        const targetPrimaryKeys = Object.fromEntries(
            auditTables.map((tableName) => [tableName, ["id"]]),
        ) as Record<string, string[]>;
        targetPrimaryKeys.peer_voting_scores = ["id", "season_id"];
        const sql = createSqlDouble({
            targetPrimaryKeys,
            rows: targetRows,
            archiveRows: [{ table_name: "users", row_count: 3 }],
        });
        return {
            sql,
            sourceInfo,
            sourceRows,
            columnsFor,
            sourceColumnNames,
            getTargetColumns: vi.fn(async (tableName: string) => columnsFor(tableName)),
        };
    };

    it("reads every audited table in a read-only transaction and builds the report", async () => {
        const fixture = buildFullFixture();
        const source = createSourceDouble({
            primaryKeys: Object.fromEntries(
                auditTables.map((tableName) => [tableName, [{ pk: 1, name: "id" }]]),
            ),
        });
        const { module, postgresClient } = await loadAuditModule({
            source,
            sql: fixture.sql,
            sourceInfo: fixture.sourceInfo,
            availableTables: new Set(auditTables),
            rowsFromSource: (tableName) => fixture.sourceRows[tableName] ?? [],
            sourceColumns: (tableName) => fixture.sourceColumnNames[tableName] ?? ["id"],
            getTargetColumns: fixture.getTargetColumns,
        });

        const report = await module.auditSqliteAgainstPostgres({
            sourcePath: " input.sqlite ",
            databaseUrl: "postgres://user@host/db",
        });

        expect(postgresClient).toHaveBeenCalledWith("postgres://user@host/db", {
            max: 1,
            connect_timeout: 10,
            prepare: false,
            idle_timeout: 5,
        });
        expect(fixture.sql.begin).toHaveBeenCalledOnce();
        expect(fixture.sql.unsafe).toHaveBeenCalledTimes(auditTables.length);
        expect(report.sourcePath).toBe("/resolved/source.sqlite");
        expect(report.sourceIntegrity).toBe("ok");
        expect(report.postgresArchivedLegacyRows).toEqual({ users: 3 });
        expect(Object.keys(report.tables)).toHaveLength(auditTables.length);

        const teams = report.tables.teams;
        expect(teams).toMatchObject({
            sourceRows: 4,
            postgresRows: 4,
            status: "compared",
        });
        expect(teams.missingInPostgres).toEqual([{ key: [9] }]);
        expect(teams.missingFields).toEqual([{ key: [2], column: "project_description" }]);
        expect(teams.conflicts).toEqual([
            {
                key: [3],
                column: "project_description",
                sqliteValue: "a",
                postgresValue: "b",
            },
        ]);
        expect(teams.postgresOnlyRows).toEqual([{ key: [4] }]);
        expect(report.tables.peer_voting_scores).toMatchObject({
            status: "compared",
            sourceKey: ["id", "season_id"],
            postgresKey: ["id", "season_id"],
        });
        expect(report.tables.peer_voting_scores.missingInPostgres).toEqual([]);

        const requestedTables = fixture.getTargetColumns.mock.calls.map(([tableName]) => tableName);
        expect(requestedTables).toContain("rubric_templates");
        expect(requestedTables).not.toContain("sqlite_legacy_data");
        expect(source.close).toHaveBeenCalledOnce();
        expect(fixture.sql.end).toHaveBeenCalledWith({ timeout: 5 });
    });

    it("closes the source and database when the transaction fails", async () => {
        const sql = createSqlDouble();
        sql.begin.mockRejectedValueOnce(new Error("transaction failed"));
        const source = createSourceDouble();
        const { module } = await loadAuditModule({
            source,
            sql,
            availableTables: new Set(["teams"]),
            sourceInfo: {
                seasonSchema: "seasonal",
                seasons: [],
                hackathonRows: [],
                legacyColumnRows: [],
                legacyJudgeRows: { rows: [] },
                orphanedTeamScores: { rows: [] },
            },
            rowsFromSource: () => [{ id: 1 }],
            sourceColumns: () => ["id"],
        });

        await expect(
            module.auditSqliteAgainstPostgres({
                sourcePath: "fixture.sqlite",
                databaseUrl: "postgres://user@host/db",
            }),
        ).rejects.toThrow("transaction failed");

        expect(source.close).toHaveBeenCalledOnce();
        expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
    });

    it("uses environment defaults and the injected postgres module", async () => {
        const openSource = vi.fn(async () => ({
            source: createSourceDouble({ primaryKeys: { teams: [{ pk: 1, name: "id" }] } }),
            sourcePath: "/env.sqlite",
        }));
        const requireDatabaseUrl = vi.fn((value?: string) => String(value));
        const sql = createSqlDouble({ targetPrimaryKeys: { teams: ["id"] } });
        const { module, postgresClient } = await loadAuditModule({
            sql,
            openSource,
            requireDatabaseUrl,
            availableTables: new Set(["teams"]),
            sourceInfo: {
                seasonSchema: "seasonal",
                seasons: [],
                hackathonRows: [],
                legacyColumnRows: [],
                legacyJudgeRows: { rows: [] },
                orphanedTeamScores: { rows: [] },
            },
            rowsFromSource: () => [{ id: 1 }],
            sourceColumns: () => ["id"],
            env: {
                SQLITE_IMPORT_PATH: "  snapshot.sqlite  ",
                DATABASE_URL: "  postgres://user@host/db  ",
            },
        });

        const report = await module.auditSqliteAgainstPostgres();

        expect(openSource).toHaveBeenCalledWith("snapshot.sqlite");
        expect(requireDatabaseUrl).toHaveBeenCalledWith("postgres://user@host/db");
        expect(postgresClient).toHaveBeenCalledWith(
            "postgres://user@host/db",
            expect.objectContaining({ max: 1 }),
        );
        expect(report.sourcePath).toBe("/env.sqlite");
        expect(report.tables.teams.status).toBe("compared");
    });
});

describe("audit CLI", () => {
    const minimalSourceInfo = (): Row => ({
        seasonSchema: "seasonal",
        sourcePath: "/cli.sqlite",
        counts: {},
        seasons: [],
        hackathonRows: [],
        legacyColumnRows: [],
        legacyJudgeRows: { rows: [] },
        orphanedTeamScores: { rows: [] },
    });

    const minimalFixture = (sql: any) => ({
        sql,
        source: createSourceDouble({ primaryKeys: { teams: [{ pk: 1, name: "id" }] } }),
        sourceInfo: minimalSourceInfo(),
        rowsFromSource: () => [{ id: 1 }],
        sourceColumns: () => ["id"],
    });

    it("rejects --apply before reading any data", async () => {
        const { module } = await loadAuditModule();

        await expect(module.main(["--apply"])).rejects.toThrow(
            "Reconciliation writes are disabled until a reviewed, backed-up target is available.",
        );
    });

    it("requires a value after --output", async () => {
        const { module } = await loadAuditModule();

        await expect(module.main(["--output"])).rejects.toThrow(
            "Pass a report path after --output.",
        );
    });

    it("writes a summary report to the requested path", async () => {
        const fixture = minimalFixture(
            createSqlDouble({ targetPrimaryKeys: { teams: ["id"] }, rows: { teams: [{ id: 1 }] } }),
        );
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { module, mkdir, open } = await loadAuditModule({
            ...fixture,
            availableTables: new Set(["teams"]),
            env: { SQLITE_IMPORT_PATH: "cli.sqlite", DATABASE_URL: "postgres://user@host/db" },
        });

        await module.main(["--output", "reports/audit.json"], {
            SQLITE_IMPORT_PATH: "cli.sqlite",
            DATABASE_URL: "postgres://user@host/db",
        });

        const outputPath = expect.stringMatching(/reports[\\/]audit\.json$/);
        expect(mkdir).toHaveBeenCalledWith(expect.stringMatching(/reports$/), { recursive: true });
        expect(open).toHaveBeenCalledWith(outputPath, "wx", 0o600);

        const file = open.mock.results[0]!.value;
        expect(file).toEqual(expect.any(Promise));
        const handle = await file;
        expect(handle.writeFile).toHaveBeenCalledOnce();
        const contents = handle.writeFile.mock.calls[0]![0] as string;
        expect(contents.endsWith("\n")).toBe(true);
        const written = JSON.parse(contents);
        expect(written.tables.teams).toMatchObject({
            sourceRows: 1,
            postgresRows: 1,
            postgresKey: ["id"],
        });
        expect(handle.close).toHaveBeenCalledOnce();

        const summary = JSON.parse(info.mock.calls[0]![0] as string);
        expect(summary.reportPath).toMatch(/reports[\\/]audit\.json$/);
        expect(summary.sourceIntegrity).toBe("ok");
        expect(summary.projectDescriptions).toBeUndefined();
        expect(summary.archivedLegacyRows).toEqual({
            removedColumns: 0,
            legacyJudgeRows: 0,
            orphanedTeamScores: 0,
        });
        expect(summary.postgresArchivedLegacyRows).toEqual({});
        expect(summary.tables.teams).toEqual({
            sourceRows: 1,
            postgresRows: 1,
            missingRows: 0,
            blankFields: 0,
            conflicts: 0,
            status: "compared",
        });
    });

    it("writes the default report path and nulls missing summary values", async () => {
        const sql = createSqlDouble();
        // A database double that skips the transaction callback leaves the target empty.
        sql.begin.mockImplementation(async () => undefined);
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const fixture = minimalFixture(sql);
        const { module, mkdir, open } = await loadAuditModule({
            ...fixture,
            availableTables: new Set(["teams"]),
        });
        process.argv = [process.execPath, "/not-the-audit-script.mjs"];

        await module.main();

        expect(mkdir).toHaveBeenCalledWith(projectRoot, {
            recursive: true,
        });
        const outputPath = open.mock.calls[0]![0] as string;
        expect(outputPath.endsWith(".tmp-sqlite-postgres-audit.json")).toBe(true);

        const summary = JSON.parse(info.mock.calls[0]![0] as string);
        expect(summary.reportPath).toBe(outputPath);
        expect(summary.tables.teams).toEqual({
            sourceRows: 1,
            postgresRows: null,
            missingRows: null,
            blankFields: null,
            conflicts: null,
            status: "missing-postgres-table",
        });
    });

    it("closes the report handle when writing fails", async () => {
        const writeFile = vi.fn(async () => {
            throw new Error("disk full");
        });
        const close = vi.fn(async () => undefined);
        const open = vi.fn(async () => ({ writeFile, close }));
        const fixture = minimalFixture(createSqlDouble({ targetPrimaryKeys: { teams: ["id"] } }));
        const { module } = await loadAuditModule({
            ...fixture,
            availableTables: new Set(["teams"]),
            open,
        });

        await expect(
            module.main(["--output", "report.json"], {
                SQLITE_IMPORT_PATH: "cli.sqlite",
                DATABASE_URL: "postgres://user@host/db",
            }),
        ).rejects.toThrow("disk full");

        expect(close).toHaveBeenCalledOnce();
    });
});

describe("audit entry point", () => {
    const entrySourceInfo = (): Row => ({
        seasonSchema: "seasonal",
        sourcePath: "/entry.sqlite",
        counts: {},
        seasons: [],
        hackathonRows: [],
        legacyColumnRows: [],
        legacyJudgeRows: { rows: [] },
        orphanedTeamScores: { rows: [] },
    });

    const entryOptions = (overrides: ModuleOptions = {}): ModuleOptions => ({
        availableTables: new Set(["teams"]),
        source: createSourceDouble({ primaryKeys: { teams: [{ pk: 1, name: "id" }] } }),
        sourceInfo: entrySourceInfo(),
        rowsFromSource: () => [{ id: 1 }],
        sourceColumns: () => ["id"],
        getTargetColumns: vi.fn(
            async () => new Map([["id", { column_name: "id", data_type: "integer" }]]),
        ),
        ...overrides,
    });

    it("does not run when argv[1] is empty", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await loadAuditModule(entryOptions({ argv1: "" }));

        expect(info).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it("runs main on import when argv[1] is the script path", async () => {
        process.exitCode = 0;
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const sql = createSqlDouble({ targetPrimaryKeys: { teams: ["id"] } });
        const { postgresClient } = await loadAuditModule(
            entryOptions({
                sql,
                argv1: scriptPath,
                argv: ["--output", "entry-audit.json"],
                env: {
                    SQLITE_IMPORT_PATH: "entry.sqlite",
                    DATABASE_URL: "postgres://user@host/db",
                },
            }),
        );

        await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());

        expect(postgresClient).toHaveBeenCalledOnce();
        const summary = JSON.parse(info.mock.calls[0]![0] as string);
        expect(summary.reportPath).toMatch(/entry-audit\.json$/);
        expect(summary.tables.teams.status).toBe("compared");
        expect(process.exitCode).toBe(0);
    });

    it("reports an Error from main and sets a failing exit code", async () => {
        process.exitCode = 0;
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const openSource = vi.fn(async () => {
            throw new Error("entry boom");
        });

        await loadAuditModule(entryOptions({ argv1: scriptPath, openSource }));

        await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
        expect(error.mock.calls[0]![0]).toBe("[SQLite/PostgreSQL audit] entry boom");
        expect(process.exitCode).toBe(1);
    });

    it("stringifies a non-Error rejection from main", async () => {
        process.exitCode = 0;
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const openSource = vi.fn(async () => {
            throw "plain boom";
        });

        await loadAuditModule(entryOptions({ argv1: scriptPath, openSource }));

        await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
        expect(error.mock.calls[0]![0]).toBe("[SQLite/PostgreSQL audit] plain boom");
        expect(process.exitCode).toBe(1);
    });
});
