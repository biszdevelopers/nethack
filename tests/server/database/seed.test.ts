import { describe, expect, it } from "vitest";
import type { DrizzleDatabase } from "~~/server/database";
import { seedDefaultSeasonAndRubrics, seedHackathon } from "~~/server/database/migrate";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { hackathon, rubricTemplates, rubricVersions, seasons } from "~~/server/database/schema";

type Table = typeof hackathon | typeof rubricTemplates | typeof rubricVersions | typeof seasons;
type Row = Record<string, any>;
type DatabaseSeed = {
    selects?: Partial<
        Record<"hackathon" | "rubricTemplates" | "rubricVersions" | "seasons", Row[][]>
    >;
    inserted?: Partial<Record<"rubricTemplates" | "rubricVersions" | "seasons", Row[][]>>;
    failAt?: "select" | "insert" | "update";
};

const tableKey = (table: Table) => {
    if (table === hackathon) return "hackathon";
    if (table === rubricTemplates) return "rubricTemplates";
    if (table === rubricVersions) return "rubricVersions";
    return "seasons";
};

function createSeedDatabase(seed: DatabaseSeed = {}) {
    const calls: Array<{ operation: string; table: string; value?: Row }> = [];
    const selectOffsets = new Map<string, number>();
    const insertOffsets = new Map<string, number>();
    const resolveQueue = (
        queues: Record<string, Row[][]> | undefined,
        key: string,
        offsets: Map<string, number>,
    ) => {
        const index = offsets.get(key) ?? 0;
        offsets.set(key, index + 1);
        return queues?.[key]?.[index] ?? [];
    };
    const failIfRequested = (operation: "select" | "insert" | "update") => {
        if (seed.failAt === operation) throw new Error(`${operation} failed`);
    };

    const tx = {
        select: () => ({
            from: (table: Table) => {
                const key = tableKey(table);
                const builder = {
                    where: () => builder,
                    orderBy: () => builder,
                    limit: () => builder,
                    then: (
                        resolve: (rows: Row[]) => unknown,
                        reject: (error: unknown) => unknown,
                    ) => {
                        try {
                            failIfRequested("select");
                            calls.push({ operation: "select", table: key });
                            return Promise.resolve(
                                resolveQueue(seed.selects, key, selectOffsets),
                            ).then(resolve, reject);
                        } catch (error) {
                            return Promise.reject(error).then(resolve, reject);
                        }
                    },
                };
                return builder;
            },
        }),
        insert: (table: Table) => {
            const key = tableKey(table);
            let value: Row | undefined;
            const result = () => {
                failIfRequested("insert");
                calls.push({ operation: "insert", table: key, value });
                return resolveQueue(seed.inserted, key, insertOffsets);
            };
            const builder = {
                values: (nextValue: Row) => {
                    value = nextValue;
                    return builder;
                },
                onConflictDoNothing: () => builder,
                returning: async () => result(),
                then: (
                    resolve: (result: unknown) => unknown,
                    reject: (error: unknown) => unknown,
                ) => {
                    try {
                        return Promise.resolve(result()).then(resolve, reject);
                    } catch (error) {
                        return Promise.reject(error).then(resolve, reject);
                    }
                },
            };
            return builder;
        },
        update: (table: Table) => {
            const key = tableKey(table);
            let value: Row | undefined;
            const builder = {
                set: (nextValue: Row) => {
                    value = nextValue;
                    return builder;
                },
                where: async () => {
                    failIfRequested("update");
                    calls.push({ operation: "update", table: key, value });
                },
            };
            return builder;
        },
    };
    const database = {
        ...tx,
        transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as DrizzleDatabase;

    return { database, calls };
}

const season = (id: number, rubric_version_id: number | null = null) => ({
    id,
    name: `Season ${id}`,
    is_active: id === 1 ? 1 : 0,
    rubric_version_id,
});

const template = { id: 10, name: "BIBS-C Default" };
const rubricVersion = (id: number, season_id: number, version = 1) => ({
    id,
    season_id,
    version,
    definition: DEFAULT_RUBRIC_DEFINITION,
});

describe("PostgreSQL default data seeding", () => {
    it("seeds the global event only when it does not already exist", async () => {
        const { database, calls } = createSeedDatabase();

        await seedHackathon(database);

        expect(calls).toEqual([
            {
                operation: "insert",
                table: "hackathon",
                value: {
                    id: 1,
                    status: "not_started",
                    start_timestamp: 0,
                    end_timestamp: 0,
                    voting_start_timestamp: 0,
                    voting_end_timestamp: 0,
                    results_open_timestamp: 0,
                },
            },
        ]);
    });

    it("creates the first season, default template, and its immutable rubric", async () => {
        const { database, calls } = createSeedDatabase({
            selects: { seasons: [[], [season(1)]], rubricTemplates: [[]] },
            inserted: { rubricTemplates: [[template]], rubricVersions: [[rubricVersion(20, 1)]] },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(
            calls.filter((call) => call.operation === "insert").map((call) => call.table),
        ).toEqual(["seasons", "rubricTemplates", "rubricVersions"]);
        expect(
            calls.find((call) => call.operation === "insert" && call.table === "seasons")?.value,
        ).toEqual({ name: "Season 1", is_active: 1 });
        expect(
            calls.find((call) => call.operation === "insert" && call.table === "rubricVersions")
                ?.value,
        ).toMatchObject({
            season_id: 1,
            version: 1,
            name: "BIBS-C Default",
            definition: DEFAULT_RUBRIC_DEFINITION,
            source_template_id: template.id,
        });
        expect(calls.at(-1)).toMatchObject({
            operation: "update",
            table: "seasons",
            value: { rubric_version_id: 20 },
        });
    });

    it("uses an existing template and reuses the latest existing season rubric", async () => {
        const existingSeason = season(3);
        const existingVersion = rubricVersion(31, 3, 4);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[template]],
                rubricVersions: [[existingVersion]],
            },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(
            calls.some((call) => call.operation === "insert" && call.table === "rubricTemplates"),
        ).toBe(false);
        expect(
            calls.some((call) => call.operation === "insert" && call.table === "rubricVersions"),
        ).toBe(false);
        expect(calls.at(-1)).toMatchObject({
            operation: "update",
            table: "seasons",
            value: { rubric_version_id: 31 },
        });
    });

    it("leaves a season alone when it already points to one of its own rubric versions", async () => {
        const existingSeason = season(2, 22);
        const ownVersion = rubricVersion(22, 2);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[template]],
                rubricVersions: [[ownVersion]],
            },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(
            calls.some((call) => call.operation === "select" && call.table === "rubricVersions"),
        ).toBe(true);
        expect(calls.some((call) => call.operation === "update" && call.table === "seasons")).toBe(
            false,
        );
        expect(
            calls.some((call) => call.operation === "insert" && call.table === "rubricVersions"),
        ).toBe(false);
    });

    it("repairs a season pointer that references a different season's rubric", async () => {
        const existingSeason = season(2, 11);
        const foreignVersion = rubricVersion(11, 1);
        const ownVersion = rubricVersion(22, 2, 3);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[template]],
                rubricVersions: [[foreignVersion], [ownVersion]],
            },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(calls.at(-1)).toMatchObject({
            operation: "update",
            table: "seasons",
            value: { rubric_version_id: 22 },
        });
        expect(
            calls.some((call) => call.operation === "insert" && call.table === "rubricVersions"),
        ).toBe(false);
    });

    it("recovers when another startup creates the default template first", async () => {
        const existingSeason = season(1);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[], [template]],
                rubricVersions: [[]],
            },
            inserted: { rubricTemplates: [[]], rubricVersions: [[rubricVersion(20, 1)]] },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(
            calls.filter((call) => call.operation === "select" && call.table === "rubricTemplates"),
        ).toHaveLength(2);
        expect(
            calls.filter((call) => call.operation === "insert" && call.table === "rubricTemplates"),
        ).toHaveLength(1);
        expect(
            calls.find((call) => call.table === "rubricVersions" && call.operation === "insert")
                ?.value,
        ).toMatchObject({
            source_template_id: template.id,
        });
    });

    it("recovers from a rubric version conflict by selecting and attaching the winner", async () => {
        const existingSeason = season(1);
        const winner = rubricVersion(40, 1);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[template]],
                rubricVersions: [[], [winner]],
            },
            inserted: { rubricVersions: [[]] },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(
            calls.filter((call) => call.operation === "select" && call.table === "rubricVersions"),
        ).toHaveLength(2);
        expect(calls.at(-1)).toMatchObject({
            operation: "update",
            table: "seasons",
            value: { rubric_version_id: 40 },
        });
    });

    it("does not update a season when a concurrent version insert cannot be recovered", async () => {
        const existingSeason = season(1);
        const { database, calls } = createSeedDatabase({
            selects: {
                seasons: [[existingSeason], [existingSeason]],
                rubricTemplates: [[template]],
                rubricVersions: [[], []],
            },
            inserted: { rubricVersions: [[]] },
        });

        await seedDefaultSeasonAndRubrics(database);

        expect(calls.some((call) => call.operation === "update" && call.table === "seasons")).toBe(
            false,
        );
    });

    it.each(["select", "insert", "update"] as const)(
        "propagates %s errors from transactional seeding",
        async (failAt) => {
            const { database } = createSeedDatabase({
                selects: {
                    seasons: [[season(1)], [season(1)]],
                    rubricTemplates: [[template]],
                    rubricVersions: [[]],
                },
                inserted: { rubricVersions: [[rubricVersion(20, 1)]] },
                failAt,
            });

            await expect(seedDefaultSeasonAndRubrics(database)).rejects.toThrow(`${failAt} failed`);
        },
    );
});
