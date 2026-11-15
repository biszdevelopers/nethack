import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        if (currentUser?.team_id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot view invitations for other teams",
            });
        }

        const invites = await getTeamInvites(event, teamID);

        return {
            invites: invites.map((invite) => ({
                id: invite.id,
                email: invite.email,
            })),
        } satisfies GetTeamInvitesResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
