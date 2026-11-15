import { NethackPermissions } from "~~/shared/permissions";
import { TeamInviteParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID, invite: inviteID } = await getValidatedRouterParams(
            event,
            TeamInviteParams.parse,
        );

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        if (currentUser?.team_id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot cancel invitations for other teams",
            });
        }

        await deleteTeamInvite(event, teamID, inviteID);

        return { message: "Invitation cancelled" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
