import { NethackPermissions } from "~~/shared/permissions";
import { TeamUserParams } from "~~/shared/schemas";
import { getTeam, canManageTeam } from "~~/server/utils/database/teams";
import { removeTeamMember } from "~~/server/utils/database/members";
import { getEventState } from "~~/server/utils/event-state";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID, user: userID } = await getValidatedRouterParams(
            event,
            TeamUserParams.parse,
        );

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersRemoveOwn);
        const team = await getTeam(event, teamID);
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        const currentTeam = currentUser.team_id ? await getTeam(event, currentUser.team_id) : null;
        if (currentTeam?.id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot remove members of other teams",
            });
        }
        // Leaving is a member decision; removing somebody else is the owner's.
        const removingSelf = currentUser.id === userID;
        if (!removingSelf && !canManageTeam(team, currentUser)) {
            throw createError({
                status: 403,
                message: "Only the team owner can remove other members",
            });
        }

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                status: 403,
                message: state.paused
                    ? "The event is paused"
                    : state.hackathon?.status === "finished" || state.hackathon?.status === "voting"
                      ? "Cannot remove members after hackathon has finished"
                      : "Cannot remove members after submissions close",
            });
        }

        if (team.project_submitted) {
            throw createError({
                status: 403,
                message: "Cannot remove members after project is submitted",
            });
        }

        await removeTeamMember(event, teamID, userID);

        return { message: "Removed user from the team" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
