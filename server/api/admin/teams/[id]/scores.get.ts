import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeamById } from "~~/server/utils/database/teams";
import { getTeamScoreFeedback } from "~~/server/utils/score-feedback";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id: teamId } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const team = await getTeamById(event, teamId);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });
        return getTeamScoreFeedback(event, team);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
