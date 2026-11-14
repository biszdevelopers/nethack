import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { CreateRubricTemplateRequest, PositiveIntParam } from "~~/shared/schemas";
import { updateRubricTemplate } from "~~/server/utils/database/rubrics";

const ParamsSchema = z.object({ id: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);
        const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const body = await readValidatedBody(event, CreateRubricTemplateRequest.parse);

        try {
            const template = await updateRubricTemplate(event, id, body);
            if (!template)
                throw createError({ statusCode: 404, message: "Rubric template not found" });
            return { template };
        } catch (error) {
            if ((error as { code?: string }).code === "23505") {
                throw createError({
                    statusCode: 409,
                    message: "A rubric template already uses that name.",
                });
            }
            throw error;
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
