import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Teams.membersAddOwn);

        const invites = await getInvitesForEmail(event, user.email);

        return {
            invites: invites.map((invite) => ({
                id: invite.id,
                team_id: invite.team_id,
                team_name: invite.team_name,
            })),
        } satisfies GetUserInvitesResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
