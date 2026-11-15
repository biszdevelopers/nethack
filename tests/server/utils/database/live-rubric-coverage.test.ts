import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION, type RubricDefinition } from "~~/shared/rubric";
import { createMockEvent } from "./helpers";

const liveConfig = vi.hoisted(() => ({
    usesYaml: true,
    rubric: undefined as { name: string; tracks: RubricDefinition["tracks"] } | undefined,
    onRead: undefined as (() => void) | undefined,
}));

vi.mock("~~/server/utils/hackathon-config", () => ({
    hackathonUsesYaml: () => liveConfig.usesYaml,
    readHackathonConfig: async () => {
        liveConfig.onRead?.();
        return { rubric: liveConfig.rubric };
    },
}));

const { resolveLiveRubricVersionId, createRubricVersion } =
    await import("~~/server/utils/database/rubrics");

const definition: RubricDefinition = {
    tracks: {
        junior: {
            name: "Junior",
            criteria: [
                {
                    id: "craft",
                    name: "Craft",
                    description: "Quality and care.",
                    weight: 100,
                    minScore: 0,
                    maxScore: 5,
                },
            ],
        },
    },
};

const liveRubric = { name: "Live rubric", ...definition };

describe("live manifest rubric materialization", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: any;

    const addLocking = () => {
        const drizzle = event.context.drizzle as any;
        const builder = drizzle.select().from({ id: 1 } as never);
        let proto = Object.getPrototypeOf(builder);
        while (proto && proto !== Object.prototype) {
            if (typeof proto.for !== "function")
                proto.for = function forLock() {
                    return this;
                };
            proto = Object.getPrototypeOf(proto);
        }
    };

    beforeEach(async () => {
        liveConfig.usesYaml = true;
        liveConfig.rubric = liveRubric;
        liveConfig.onRead = undefined;
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        raw.function("now", () => new Date(0).toISOString());
        addLocking();
    });

    const seedSeason = (id: number, isActive: 0 | 1, pointer: number | null = null) => {
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(?, ?, ?)").run(
            id,
            `Season ${id}`,
            isActive,
        );
        if (pointer !== null) {
            raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?").run(pointer, id);
        }
    };

    const seedVersion = (
        id: number,
        seasonId: number,
        version: number,
        name: string,
        value: RubricDefinition = definition,
    ) => {
        raw.prepare(
            "INSERT INTO rubric_versions(id, season_id, version, name, definition) VALUES(?, ?, ?, ?, ?)",
        ).run(id, seasonId, version, name, JSON.stringify(value));
        return id;
    };

    it("reuses the version the season already points at when it matches the manifest", async () => {
        seedSeason(1, 1);
        const versionId = seedVersion(10, 1, 1, "Live rubric");
        raw.prepare("UPDATE seasons SET rubric_version_id = 10 WHERE id = 1").run();

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: versionId,
            }),
        ).resolves.toBe(versionId);
        expect(raw.prepare("SELECT count(*) AS count FROM rubric_versions").get()).toEqual({
            count: 1,
        });
    });

    it("keeps the stored pointer when the manifest has no rubric", async () => {
        liveConfig.rubric = undefined;
        seedSeason(1, 1, 7);

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: 7,
            }),
        ).resolves.toBe(7);
    });

    it("does not touch historical seasons or database mode", async () => {
        seedSeason(2, 0);
        await expect(
            resolveLiveRubricVersionId(event, {
                id: 2,
                is_active: 0,
                rubric_version_id: 3,
            }),
        ).resolves.toBe(3);

        liveConfig.usesYaml = false;
        await expect(
            resolveLiveRubricVersionId(event, {
                id: 2,
                is_active: 1,
                rubric_version_id: 3,
            }),
        ).resolves.toBe(3);
    });

    it.each([
        ["a version from another season", 20, 2, "Live rubric", definition, 1],
        ["a differently named version", 21, 1, "Stale rubric", definition, 5],
        ["a version with stale criteria", 22, 1, "Live rubric", DEFAULT_RUBRIC_DEFINITION, 5],
    ])(
        "materializes %s into a new version",
        async (_case, versionId, seasonId, name, value, expectedVersion) => {
            seedSeason(1, 1, versionId);
            seedVersion(versionId, seasonId, 4, name, value);

            const resolved = await resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: versionId,
            });

            expect(resolved).not.toBe(versionId);
            expect(raw.prepare("SELECT rubric_version_id FROM seasons WHERE id = 1").get()).toEqual(
                {
                    rubric_version_id: resolved,
                },
            );
            expect(
                raw.prepare("SELECT name, version FROM rubric_versions WHERE id = ?").get(resolved),
            ).toEqual({ name: "Live rubric", version: expectedVersion });
        },
    );

    it("repoints a stale season argument to the pointer the lock already holds", async () => {
        seedSeason(1, 1);
        const versionId = seedVersion(26, 1, 1, "Live rubric");
        raw.prepare("UPDATE seasons SET rubric_version_id = 26 WHERE id = 1").run();

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: null,
            }),
        ).resolves.toBe(versionId);
        expect(raw.prepare("SELECT count(*) AS count FROM rubric_versions").get()).toEqual({
            count: 1,
        });
    });

    it("creates the first version when the season has none", async () => {
        seedSeason(1, 1);

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: null,
            }),
        ).resolves.toEqual(expect.any(Number));
        expect(
            raw.prepare("SELECT version, name FROM rubric_versions WHERE season_id = 1").get(),
        ).toEqual({ version: 1, name: "Live rubric" });
    });

    it("repoints to an existing manifest version instead of inserting a duplicate", async () => {
        seedSeason(1, 1, 31);
        seedVersion(31, 1, 1, "Stale rubric");
        seedVersion(32, 1, 2, "Live rubric");

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: 31,
            }),
        ).resolves.toBe(32);
        expect(raw.prepare("SELECT rubric_version_id FROM seasons WHERE id = 1").get()).toEqual({
            rubric_version_id: 32,
        });
        expect(raw.prepare("SELECT count(*) AS count FROM rubric_versions").get()).toEqual({
            count: 2,
        });
    });

    it("returns the locked pointer when the season is no longer live", async () => {
        seedSeason(1, 0, 41);
        liveConfig.onRead = () => {
            raw.prepare("UPDATE seasons SET is_active = 0 WHERE id = 1").run();
        };

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: 41,
            }),
        ).resolves.toBe(41);
    });

    it("returns null when the season disappears before the lock", async () => {
        seedSeason(1, 1);
        liveConfig.onRead = () => {
            raw.prepare("DELETE FROM seasons WHERE id = 1").run();
        };

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: null,
            }),
        ).resolves.toBeNull();
    });

    it("refuses to drop the track used by a submitted team", async () => {
        seedSeason(1, 1);
        raw.prepare(
            "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Senior team', 1, 1, 'senior')",
        ).run();

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: null,
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("reports a failed manifest version insert", async () => {
        const makeQuery = (rows: unknown[]) => {
            const query: Record<string, any> = {
                from: () => query,
                where: () => query,
                orderBy: () => query,
                limit: () => query,
                for: () => query,
                then: (
                    resolve: (value: unknown[]) => unknown,
                    reject: (reason: unknown) => unknown,
                ) => Promise.resolve(rows).then(resolve, reject),
            };
            return query;
        };
        const tx = {
            select: () => makeQuery([{ id: 1, is_active: 1, rubric_version_id: null }]),
            selectDistinct: () => ({
                from: () => ({ where: async () => [] }),
            }),
            insert: () => ({
                values: () => ({ returning: async () => [] }),
            }),
            update: () => ({ set: () => ({ where: async () => undefined }) }),
        };
        event.context.drizzle = {
            select: () => makeQuery([]),
            transaction: async (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never;

        await expect(
            resolveLiveRubricVersionId(event, {
                id: 1,
                is_active: 1,
                rubric_version_id: null,
            }),
        ).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to save YAML rubric version",
        });
    });

    it("refuses manual rubric edits on the manifest-managed active season", async () => {
        seedSeason(1, 1);

        await expect(
            createRubricVersion(event, 1, {
                name: "Manual",
                definition,
                createdBy: 1,
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("still allows manual rubric edits on a historical season in manifest mode", async () => {
        seedSeason(1, 0);

        await expect(
            createRubricVersion(event, 1, {
                name: "Manual",
                definition,
                createdBy: 1,
            }),
        ).resolves.toMatchObject({ name: "Manual", version: 1 });
    });
});
