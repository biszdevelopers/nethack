import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { canManageTeam, disbandTeam, getTeam } from "~~/server/utils/database/teams";
import { getEventState } from "~~/server/utils/event-state";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const user = await requireUser(event, NethackPermissions.Teams.membersRemoveOwn);
        const team = await getTeam(event, teamID);
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        if (!canManageTeam(team, user)) {
            throw createError({ statusCode: 403, message: "Only the team owner can disband it" });
        }

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                statusCode: 403,
                message: state.paused
                    ? "The event is paused"
                    : "Cannot disband a team after submissions close",
            });
        }

        await disbandTeam(event, teamID);

        return { message: "Team disbanded" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
