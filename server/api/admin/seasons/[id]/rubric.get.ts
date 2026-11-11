import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { rubricVersions, seasons } from "~~/server/database/schema";
import { listRubricTemplates } from "~~/server/utils/database/rubrics";
import { firstRow } from "~~/server/utils/database/query";

const ParamsSchema = z.object({ id: PositiveIntParam });

export default defineEventHandler(async (event) => {
    await requireUser(event, NethackPermissions.Seasons.update);
    const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
    const season = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.id, id)).limit(1),
    );
    if (!season) throw createError({ statusCode: 404, message: "Season not found" });

    const [versions, templates] = await Promise.all([
        event.context.drizzle
            .select()
            .from(rubricVersions)
            .where(eq(rubricVersions.season_id, id))
            .orderBy(desc(rubricVersions.version)),
        listRubricTemplates(event),
    ]);
    const active = versions.find((version) => version.id === season.rubric_version_id) ?? null;
    return { active, versions, templates };
});
