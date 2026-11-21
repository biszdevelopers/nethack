import { NethackPermissions } from "~~/shared/permissions";
import { TeamInviteParams } from "~~/shared/schemas";
import { canManageTeam, getTeam } from "~~/server/utils/database/teams";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID, invite: inviteID } = await getValidatedRouterParams(
            event,
            TeamInviteParams.parse,
        );

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        const team = await getTeam(event, teamID);
        const currentTeam = currentUser.team_id ? await getTeam(event, currentUser.team_id) : null;
        if (!team || currentTeam?.id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot cancel invitations for other teams",
            });
        }
        if (!canManageTeam(team, currentUser)) {
            throw createError({
                status: 403,
                message: "Only the team owner can cancel invitations",
            });
        }

        await deleteTeamInvite(event, teamID, inviteID);

        return { message: "Invitation cancelled" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
