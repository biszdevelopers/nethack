import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { listRubricTemplates } from "~~/server/utils/database/rubrics";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);
        return { templates: await listRubricTemplates(event) };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
