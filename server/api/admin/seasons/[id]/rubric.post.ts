import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { CreateRubricVersionRequest, PositiveIntParam } from "~~/shared/schemas";
import { createRubricVersion } from "~~/server/utils/database/rubrics";

const ParamsSchema = z.object({ id: PositiveIntParam });

export default defineEventHandler(async (event) => {
    const user = await requireUser(event, NethackPermissions.Seasons.update);
    const { id: seasonId } = await getValidatedRouterParams(event, ParamsSchema.parse);
    const body = await readValidatedBody(event, CreateRubricVersionRequest.parse);

    const version = await createRubricVersion(event, seasonId, {
        ...body,
        createdBy: user.id,
    });
    if (!version) throw createError({ statusCode: 404, message: "Season not found" });
    return { active: version };
});
