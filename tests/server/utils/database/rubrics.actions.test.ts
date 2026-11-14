import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_RUBRIC_DEFINITION,
    type RubricDefinition,
    withDefaultRubricCommentGuidance,
} from "~~/shared/rubric";
import {
    createRubricTemplate,
    createRubricVersion,
    deleteRubricTemplate,
    getRubricVersionForSeason,
    listRubricTemplates,
    updateRubricTemplate,
} from "~~/server/utils/database/rubrics";
import { resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";
import { createMockEvent } from "./helpers";

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

function parseDefinition(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
}

describe("rubric database actions", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let rawDb: any;

    const insertSeason = (id: number, name = `Season ${id}`) => {
        rawDb.prepare("INSERT INTO seasons(id, name, is_active) VALUES(?, ?, 0)").run(id, name);
    };

    const insertVersion = (
        seasonId: number,
        version: number,
        rubricDefinition: RubricDefinition = definition,
    ) => {
        const result = rawDb
            .prepare(
                "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(?, ?, ?, ?)",
            )
            .run(seasonId, version, `Rubric ${version}`, JSON.stringify(rubricDefinition));
        return Number(result.lastInsertRowid);
    };

    beforeEach(async () => {
        event = await createMockEvent();
        rawDb = event.context.drizzle.getRawDb();
    });

    describe("season rubric lookup", () => {
        it("returns null when the season does not exist", async () => {
            await expect(getRubricVersionForSeason(event, 90)).resolves.toBeNull();
        });

        it("returns null when the season has no active rubric pointer", async () => {
            insertSeason(1);

            await expect(getRubricVersionForSeason(event, 1)).resolves.toBeNull();
        });

        it("returns null when the pointer refers to another season's version", async () => {
            insertSeason(1);
            insertSeason(2);
            const foreignVersionId = insertVersion(2, 1);
            rawDb
                .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?")
                .run(foreignVersionId, 1);

            await expect(getRubricVersionForSeason(event, 1)).resolves.toBeNull();
        });

        it("returns the pointed rubric version scoped to the requested season", async () => {
            insertSeason(1);
            const versionId = insertVersion(1, 1);
            rawDb
                .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?")
                .run(versionId, 1);

            await expect(getRubricVersionForSeason(event, 1)).resolves.toMatchObject({
                id: versionId,
                season_id: 1,
                version: 1,
            });
        });
    });

    describe("season rubric versions", () => {
        it("returns null instead of creating a version for a missing target season", async () => {
            await expect(
                createRubricVersion(event, 404, {
                    name: "Unavailable",
                    definition,
                    createdBy: 17,
                }),
            ).resolves.toBeNull();
        });

        it("creates direct definitions as immutable, sequential versions and advances the pointer", async () => {
            insertSeason(1);

            const first = await createRubricVersion(event, 1, {
                name: "Initial",
                definition,
                createdBy: 17,
            });
            const second = await createRubricVersion(event, 1, {
                name: "Updated",
                definition: DEFAULT_RUBRIC_DEFINITION,
                createdBy: 18,
            });

            expect(first).toMatchObject({
                season_id: 1,
                version: 1,
                name: "Initial",
                created_by: 17,
            });
            expect(second).toMatchObject({
                season_id: 1,
                version: 2,
                name: "Updated",
                created_by: 18,
            });
            expect(parseDefinition(first?.definition)).toEqual(definition);
            expect(parseDefinition(second?.definition)).toEqual(DEFAULT_RUBRIC_DEFINITION);
            expect(
                rawDb.prepare("SELECT rubric_version_id FROM seasons WHERE id = 1").get()
                    ?.rubric_version_id,
            ).toBe(second?.id);
            expect(
                rawDb
                    .prepare("SELECT count(*) AS count FROM rubric_versions WHERE season_id = 1")
                    .get()?.count,
            ).toBe(2);
        });

        it("rejects a missing definition with a client error", async () => {
            insertSeason(1);

            await expect(
                createRubricVersion(event, 1, { name: "Missing", createdBy: 17 }),
            ).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: "Rubric definition is required",
            });
        });

        it("locks the target season and reports a failed version insert", async () => {
            const lockSeason = vi.fn();
            const makeSelectQuery = (rows: unknown[], supportsLock = false) => {
                const query: Record<string, any> = {
                    from: vi.fn(() => query),
                    where: vi.fn(() => query),
                    orderBy: vi.fn(() => query),
                    limit: vi.fn(() => query),
                    then: (
                        resolve: (value: unknown[]) => unknown,
                        reject: (reason: unknown) => unknown,
                    ) => Promise.resolve(rows).then(resolve, reject),
                };
                if (supportsLock) {
                    query.for = vi.fn((strength: string) => {
                        lockSeason(strength);
                        return query;
                    });
                }
                return query;
            };
            const season = { id: 1, rubric_version_id: null };
            const select = vi
                .fn()
                .mockReturnValueOnce(makeSelectQuery([season], true))
                .mockReturnValueOnce(makeSelectQuery([]));
            const tx = {
                select,
                selectDistinct: vi.fn(() => ({
                    from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
                })),
                insert: vi.fn(() => ({
                    values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
                })),
            };
            event.context.drizzle = {
                transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx),
            } as any;

            await expect(
                createRubricVersion(event, 1, { name: "No row", definition, createdBy: 17 }),
            ).rejects.toMatchObject({
                statusCode: 500,
                statusMessage: "Failed to save rubric version",
            });
            expect(lockSeason).toHaveBeenCalledWith("update");
        });

        it("copies a reusable template and records its source template id", async () => {
            insertSeason(1);
            const template = await createRubricTemplate(event, {
                name: "Junior template",
                definition,
                createdBy: 23,
            });

            const version = await createRubricVersion(event, 1, {
                name: "Season copy",
                sourceTemplateId: template!.id,
                createdBy: 17,
            });

            expect(version).toMatchObject({
                season_id: 1,
                version: 1,
                source_template_id: template?.id,
                created_by: 17,
            });
            expect(parseDefinition(version?.definition)).toEqual(
                withDefaultRubricCommentGuidance(definition),
            );
        });

        it("reports a missing reusable template", async () => {
            insertSeason(1);

            await expect(
                createRubricVersion(event, 1, {
                    name: "Missing template",
                    sourceTemplateId: 900,
                    createdBy: 17,
                }),
            ).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Rubric template not found",
            });
        });

        it("copies the active rubric from a prior season without changing its source version", async () => {
            insertSeason(1, "Target");
            insertSeason(2, "Prior season");
            const sourceVersionId = insertVersion(2, 4);
            rawDb
                .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = ?")
                .run(sourceVersionId, 2);

            const copied = await createRubricVersion(event, 1, {
                name: "Copied history",
                copyFromSeasonId: 2,
                createdBy: 17,
            });

            expect(copied).toMatchObject({ season_id: 1, version: 1, name: "Copied history" });
            expect(parseDefinition(copied?.definition)).toEqual(
                withDefaultRubricCommentGuidance(definition),
            );
            expect(
                rawDb.prepare("SELECT id, version FROM rubric_versions WHERE season_id = 2").get(),
            ).toEqual({ id: sourceVersionId, version: 4 });
            expect(
                rawDb.prepare("SELECT rubric_version_id FROM seasons WHERE id = 2").get()
                    ?.rubric_version_id,
            ).toBe(sourceVersionId);
        });

        it("rejects copying from a season that does not exist", async () => {
            insertSeason(1);

            await expect(
                createRubricVersion(event, 1, {
                    name: "Missing source",
                    copyFromSeasonId: 404,
                    createdBy: 17,
                }),
            ).rejects.toMatchObject({ statusCode: 404, statusMessage: "Source season not found" });
        });

        it("rejects copying from a season without a rubric", async () => {
            insertSeason(1, "Target");
            insertSeason(2, "Empty source");

            await expect(
                createRubricVersion(event, 1, {
                    name: "Empty source copy",
                    copyFromSeasonId: 2,
                    createdBy: 17,
                }),
            ).rejects.toMatchObject({
                statusCode: 409,
                statusMessage: "Source season has no rubric",
            });
        });

        it.each([
            ["an unassigned submitted team", null],
            ["a track omitted from the definition", "senior"],
        ])("rejects removing the track used by %s", async (_description, pathway) => {
            insertSeason(1);
            rawDb
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES(?, 1, 1, ?)",
                )
                .run(`Submitted ${String(pathway)}`, pathway);

            await expect(
                createRubricVersion(event, 1, {
                    name: "Track removal",
                    definition,
                    createdBy: 17,
                }),
            ).rejects.toMatchObject({
                statusCode: 409,
                statusMessage:
                    "Move submitted teams to a remaining track before removing this rubric track.",
            });
            expect(
                rawDb
                    .prepare("SELECT count(*) AS count FROM rubric_versions WHERE season_id = 1")
                    .get()?.count,
            ).toBe(0);
        });

        it("allows replacing a rubric when every submitted track remains available", async () => {
            insertSeason(1);
            rawDb
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Junior team', 1, 1, 'junior')",
                )
                .run();

            const version = await createRubricVersion(event, 1, {
                name: "Safe replacement",
                definition,
                createdBy: 17,
            });

            expect(version?.version).toBe(1);
            expect(parseDefinition(version?.definition)).toEqual(definition);
        });
    });

    describe("reusable rubric templates", () => {
        it("creates templates and defaults omitted descriptions to null", async () => {
            const created = await createRubricTemplate(event, {
                name: "Junior",
                definition,
                createdBy: 31,
            });

            expect(created).toMatchObject({ name: "Junior", description: null, created_by: 31 });
            expect(parseDefinition(created?.definition)).toEqual(definition);
            expect(created?.created_at).toBeDefined();
            expect(created?.updated_at).toBeDefined();
        });

        it("lists templates alphabetically and returns an empty list when none exist", async () => {
            expect(await listRubricTemplates(event)).toEqual([]);
            await createRubricTemplate(event, { name: "Zulu", definition, createdBy: 1 });
            await createRubricTemplate(event, { name: "Alpha", definition, createdBy: 2 });
            await createRubricTemplate(event, { name: "Middle", definition, createdBy: 3 });

            const templates = await listRubricTemplates(event);

            expect(templates.map(({ name }) => name)).toEqual(["Alpha", "Middle", "Zulu"]);
        });

        it("updates a template and clears its description when omitted", async () => {
            const initial = await createRubricTemplate(event, {
                name: "Before",
                description: "Old notes",
                definition,
                createdBy: 31,
            });

            const updated = await updateRubricTemplate(event, initial!.id, {
                name: "After",
                definition: DEFAULT_RUBRIC_DEFINITION,
            });

            expect(updated).toMatchObject({ id: initial?.id, name: "After", description: null });
            expect(parseDefinition(updated?.definition)).toEqual(DEFAULT_RUBRIC_DEFINITION);
            expect(updated?.updated_at).toBeDefined();
        });

        it("returns null when updating a template that does not exist", async () => {
            await expect(
                updateRubricTemplate(event, 404, { name: "Missing", definition }),
            ).resolves.toBeUndefined();
        });

        it("deletes a template and returns null for a repeated deletion", async () => {
            const created = await createRubricTemplate(event, {
                name: "Delete me",
                definition,
                createdBy: 31,
            });

            await expect(deleteRubricTemplate(event, created!.id)).resolves.toEqual({
                id: created?.id,
            });
            await expect(deleteRubricTemplate(event, created!.id)).resolves.toBeUndefined();
        });
    });
});

describe("admin rubric route authorization", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        resetMockState();
        setupNitroGlobals();
        event = await createMockEvent();
    });

    it.each([
        ["template listing", () => import("~~/server/api/admin/rubric-templates/index.get")],
        ["template creation", () => import("~~/server/api/admin/rubric-templates/index.post")],
        ["template editing", () => import("~~/server/api/admin/rubric-templates/[id].put")],
        ["template deletion", () => import("~~/server/api/admin/rubric-templates/[id].delete")],
        [
            "season rubric version creation",
            () => import("~~/server/api/admin/seasons/[id]/rubric.post"),
        ],
    ])("denies unauthenticated %s before database changes", async (_action, loadRoute) => {
        const { default: handler } = await loadRoute();

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
        expect(
            event.context.drizzle
                .getRawDb()
                .prepare("SELECT count(*) AS count FROM rubric_templates")
                .get().count,
        ).toBe(0);
        expect(
            event.context.drizzle
                .getRawDb()
                .prepare("SELECT count(*) AS count FROM rubric_versions")
                .get().count,
        ).toBe(0);
    });
});
