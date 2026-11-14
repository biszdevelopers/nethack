import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { createRubricVersion } from "~~/server/utils/database/rubrics";
import { createMockEvent } from "./helpers";

describe("createRubricVersion", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    const juniorOnlyDefinition = {
        tracks: { junior: DEFAULT_RUBRIC_DEFINITION.tracks.junior },
    };

    beforeEach(async () => {
        event = await createMockEvent();
        const rawDb = event.context.drizzle.getRawDb();
        rawDb.prepare("INSERT INTO seasons(id, name, is_active) VALUES(42, 'Target', 1)").run();
    });

    it.each(["direct definition", "template copy", "prior-season copy"])(
        "checks submitted tracks when creating from a %s",
        async (source) => {
            const rawDb = event.context.drizzle.getRawDb();
            rawDb
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Senior team', 42, 1, 'senior')",
                )
                .run();

            let sourceFields: {
                definition?: typeof juniorOnlyDefinition;
                sourceTemplateId?: number;
                copyFromSeasonId?: number;
            } = {
                definition: juniorOnlyDefinition,
            };
            if (source === "template copy") {
                rawDb
                    .prepare(
                        "INSERT INTO rubric_templates(name, definition) VALUES('Junior-only', ?)",
                    )
                    .run(JSON.stringify(juniorOnlyDefinition));
                sourceFields = { sourceTemplateId: 1 };
            } else if (source === "prior-season copy") {
                rawDb
                    .prepare("INSERT INTO seasons(id, name, is_active) VALUES(43, 'Source', 0)")
                    .run();
                const sourceRubric = rawDb
                    .prepare(
                        "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(43, 1, 'Junior-only', ?)",
                    )
                    .run(JSON.stringify(juniorOnlyDefinition));
                rawDb
                    .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = 43")
                    .run(Number(sourceRubric.lastInsertRowid));
                sourceFields = { copyFromSeasonId: 43 };
            }

            await expect(
                createRubricVersion(event, 42, {
                    name: "Unsafe replacement",
                    ...sourceFields,
                    createdBy: 1,
                }),
            ).rejects.toThrow("Move submitted teams to a remaining track");

            expect(
                rawDb
                    .prepare("SELECT count(*) AS count FROM rubric_versions WHERE season_id = 42")
                    .get().count,
            ).toBe(0);
        },
    );

    it("allows a rubric that retains every submitted track", async () => {
        const rawDb = event.context.drizzle.getRawDb();
        rawDb
            .prepare(
                "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Senior team', 42, 1, 'senior')",
            )
            .run();

        const version = await createRubricVersion(event, 42, {
            name: "Complete replacement",
            definition: DEFAULT_RUBRIC_DEFINITION,
            createdBy: 1,
        });

        expect(version?.season_id).toBe(42);
        expect(version?.definition.tracks.senior).toEqual(DEFAULT_RUBRIC_DEFINITION.tracks.senior);
    });
});
