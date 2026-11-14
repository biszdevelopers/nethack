import { and, asc, desc, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { isDeepStrictEqual } from "node:util";
import { withDefaultRubricCommentGuidance, type RubricDefinition } from "~~/shared/rubric";
import { rubricTemplates, rubricVersions, seasons, teams } from "~~/server/database/schema";
import { firstRow } from "./query";
import { hackathonUsesYaml, readHackathonConfig } from "../hackathon-config";

type RubricSeason = Pick<Season, "id" | "is_active" | "rubric_version_id">;

/** Materialize the manifest as an immutable version before returning its database ID. */
export async function resolveLiveRubricVersionId(event: H3Event, season: RubricSeason) {
    if (!hackathonUsesYaml() || season.is_active !== 1) return season.rubric_version_id;
    const { rubric } = await readHackathonConfig();
    if (!rubric) return season.rubric_version_id;

    const { name, ...rawDefinition } = rubric;
    const definition = withDefaultRubricCommentGuidance(rawDefinition);
    const matches = (version: typeof rubricVersions.$inferSelect | undefined) =>
        version?.season_id === season.id &&
        version.name === name &&
        isDeepStrictEqual(withDefaultRubricCommentGuidance(version.definition), definition);
    const db = event.context.drizzle;
    const current = await firstRow(
        db
            .select()
            .from(rubricVersions)
            .where(eq(rubricVersions.id, season.rubric_version_id ?? -1))
            .limit(1),
    );
    if (matches(current)) return current!.id;

    return db.transaction(async (tx) => {
        const [locked] = await tx
            .select()
            .from(seasons)
            .where(eq(seasons.id, season.id))
            .for("update");
        if (!locked || locked.is_active !== 1) return locked?.rubric_version_id ?? null;
        const versions = await tx
            .select()
            .from(rubricVersions)
            .where(eq(rubricVersions.season_id, season.id))
            .orderBy(desc(rubricVersions.version));
        const existing = versions.find(matches);
        if (existing && existing.id === locked.rubric_version_id) return existing.id;

        await validateSubmittedTracks(tx, season.id, definition);
        const [version] = existing
            ? [existing]
            : await tx
                  .insert(rubricVersions)
                  .values({
                      season_id: season.id,
                      version: (versions[0]?.version ?? 0) + 1,
                      name,
                      definition,
                  })
                  .returning();
        if (!version)
            throw createError({ statusCode: 500, message: "Failed to save YAML rubric version" });
        await tx
            .update(seasons)
            .set({ rubric_version_id: version.id })
            .where(eq(seasons.id, season.id));
        return version.id;
    });
}

type RubricQuery = Pick<H3Event["context"]["drizzle"], "selectDistinct">;

async function validateSubmittedTracks(
    db: RubricQuery,
    seasonId: number,
    definition: RubricDefinition,
) {
    const submittedTracks = await db
        .selectDistinct({ pathway: teams.pathway })
        .from(teams)
        .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1)));
    if (
        submittedTracks.some(
            ({ pathway }) => !pathway || !Object.hasOwn(definition.tracks, pathway),
        )
    ) {
        throw createError({
            statusCode: 409,
            message: "Move submitted teams to a remaining track before removing this rubric track.",
        });
    }
}

export async function getRubricVersionForSeason(event: H3Event, seasonId: number) {
    const season = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
    );
    if (!season) return null;
    const versionId = await resolveLiveRubricVersionId(event, season);
    if (!versionId) return null;

    return (
        (await firstRow(
            event.context.drizzle
                .select()
                .from(rubricVersions)
                .where(
                    and(eq(rubricVersions.id, versionId), eq(rubricVersions.season_id, seasonId)),
                )
                .limit(1),
        )) ?? null
    );
}

export interface CreateRubricVersionInput {
    name: string;
    definition?: RubricDefinition;
    copyFromSeasonId?: number;
    sourceTemplateId?: number;
    createdBy: number;
}

export async function createRubricVersion(
    event: H3Event,
    seasonId: number,
    input: CreateRubricVersionInput,
) {
    const yamlRubric = hackathonUsesYaml() && (await readHackathonConfig()).rubric;
    return event.context.drizzle.transaction(async (tx) => {
        const seasonQuery = tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
        const season = await firstRow(
            typeof (seasonQuery as any).for === "function"
                ? (seasonQuery as any).for("update")
                : seasonQuery,
        );
        if (!season) return null;
        if (yamlRubric && season.is_active === 1) {
            throw createError({
                statusCode: 409,
                message: "Edit the rubric section of HACKATHON.yml to change the active rubric.",
            });
        }

        let definition = input.definition;
        let sourceTemplateId: number | null = input.sourceTemplateId ?? null;
        if (input.copyFromSeasonId !== undefined) {
            const sourceSeason = await firstRow(
                tx.select().from(seasons).where(eq(seasons.id, input.copyFromSeasonId)).limit(1),
            );
            if (!sourceSeason) {
                throw createError({ statusCode: 404, message: "Source season not found" });
            }

            const sourceVersion = sourceSeason.rubric_version_id
                ? await firstRow(
                      tx
                          .select()
                          .from(rubricVersions)
                          .where(
                              and(
                                  eq(rubricVersions.id, sourceSeason.rubric_version_id),
                                  eq(rubricVersions.season_id, sourceSeason.id),
                              ),
                          )
                          .limit(1),
                  )
                : undefined;
            if (!sourceVersion) {
                throw createError({ statusCode: 409, message: "Source season has no rubric" });
            }
            definition = withDefaultRubricCommentGuidance(sourceVersion.definition);
            sourceTemplateId = sourceVersion.source_template_id;
        } else if (input.sourceTemplateId !== undefined) {
            const template = await firstRow(
                tx
                    .select()
                    .from(rubricTemplates)
                    .where(eq(rubricTemplates.id, input.sourceTemplateId))
                    .limit(1),
            );
            if (!template) {
                throw createError({ statusCode: 404, message: "Rubric template not found" });
            }
            definition = withDefaultRubricCommentGuidance(template.definition);
        }

        if (!definition) {
            throw createError({ statusCode: 400, message: "Rubric definition is required" });
        }

        await validateSubmittedTracks(tx, seasonId, definition);

        const previousVersion = await firstRow(
            tx
                .select()
                .from(rubricVersions)
                .where(eq(rubricVersions.season_id, seasonId))
                .orderBy(desc(rubricVersions.version))
                .limit(1),
        );
        const version = await firstRow(
            tx
                .insert(rubricVersions)
                .values({
                    season_id: seasonId,
                    version: (previousVersion?.version ?? 0) + 1,
                    name: input.name,
                    definition,
                    source_template_id: sourceTemplateId,
                    created_by: input.createdBy,
                    created_at: new Date(),
                })
                .returning(),
        );
        if (!version) {
            throw createError({ statusCode: 500, message: "Failed to save rubric version" });
        }

        await tx
            .update(seasons)
            .set({ rubric_version_id: version.id })
            .where(eq(seasons.id, seasonId));
        return version;
    });
}

export async function listRubricTemplates(event: H3Event) {
    return event.context.drizzle.select().from(rubricTemplates).orderBy(asc(rubricTemplates.name));
}

export async function createRubricTemplate(
    event: H3Event,
    input: { name: string; description?: string; definition: RubricDefinition; createdBy: number },
) {
    return firstRow(
        event.context.drizzle
            .insert(rubricTemplates)
            .values({
                name: input.name,
                description: input.description ?? null,
                definition: input.definition,
                created_by: input.createdBy,
                created_at: new Date(),
                updated_at: new Date(),
            })
            .returning(),
    );
}

export async function updateRubricTemplate(
    event: H3Event,
    templateId: number,
    input: { name: string; description?: string; definition: RubricDefinition },
) {
    return firstRow(
        event.context.drizzle
            .update(rubricTemplates)
            .set({
                name: input.name,
                description: input.description ?? null,
                definition: input.definition,
                updated_at: new Date(),
            })
            .where(eq(rubricTemplates.id, templateId))
            .returning(),
    );
}

export async function deleteRubricTemplate(event: H3Event, templateId: number) {
    return firstRow(
        event.context.drizzle
            .delete(rubricTemplates)
            .where(eq(rubricTemplates.id, templateId))
            .returning({ id: rubricTemplates.id }),
    );
}
