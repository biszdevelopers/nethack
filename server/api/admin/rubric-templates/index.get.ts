import { NethackPermissions } from "~~/shared/permissions";
import { listRubricTemplates } from "~~/server/utils/database/rubrics";

export default defineEventHandler(async (event) => {
    await requireUser(event, NethackPermissions.Seasons.update);
    return { templates: await listRubricTemplates(event) };
});
