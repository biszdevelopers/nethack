import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { CreateRubricTemplateRequest } from "~~/shared/schemas";
import { createRubricTemplate } from "~~/server/utils/database/rubrics";
import { isUniqueViolation } from "~~/server/utils/database/query";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Seasons.update);
        const body = await readValidatedBody(event, CreateRubricTemplateRequest.parse);

        try {
            const template = await createRubricTemplate(event, { ...body, createdBy: user.id });
            if (!template)
                throw createError({ statusCode: 500, message: "Unable to create rubric template" });
            return { template };
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw createError({
                    statusCode: 409,
                    message: "A rubric template already uses that name.",
                });
            }
            throw error;
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
