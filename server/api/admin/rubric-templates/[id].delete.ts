import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { deleteRubricTemplate } from "~~/server/utils/database/rubrics";

const ParamsSchema = z.object({ id: PositiveIntParam });

export default defineEventHandler(async (event) => {
    await requireUser(event, NethackPermissions.Seasons.update);
    const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
    const deleted = await deleteRubricTemplate(event, id);
    if (!deleted) throw createError({ statusCode: 404, message: "Rubric template not found" });
    return { message: "Rubric template deleted." };
});
