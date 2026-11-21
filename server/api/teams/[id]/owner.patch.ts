import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams, TransferTeamOwnerRequest } from "~~/shared/schemas";
import { canManageTeam, getTeam, transferTeamOwnership } from "~~/server/utils/database/teams";
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
            throw createError({
                status: 403,
                message: "Only the team owner can transfer ownership",
            });
        }

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                statusCode: 403,
                message: state.paused
                    ? "The event is paused"
                    : "Cannot change team members after submissions close",
            });
        }
        if (team.project_submitted) {
            throw createError({
                statusCode: 409,
                message: "Cannot transfer ownership after the project is submitted",
            });
        }

        const { user_id: newOwnerUserID } = await readValidatedBody(
            event,
            TransferTeamOwnerRequest.parse,
        );
        await transferTeamOwnership(event, teamID, newOwnerUserID);

        return { message: "Team ownership transferred" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
