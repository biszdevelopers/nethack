import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeamById } from "~~/server/utils/database/teams";
import { getAwards } from "~~/server/utils/database/awards";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const team = await getTeamById(event, id);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });
        return { awards: await getAwards(event, id) };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
