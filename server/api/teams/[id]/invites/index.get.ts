import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeam } from "~~/server/utils/database/teams";
import { getTeamInvites, getTeamMemberLimit } from "~~/server/utils/database/members";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        // Resolve the pointer against the active season so a stale team_id from
        // an ended season cannot expose another team's invitations.
        const currentTeam = currentUser.team_id ? await getTeam(event, currentUser.team_id) : null;
        if (currentTeam?.id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot view invitations for other teams",
            });
        }

        const [invites, max_team_members] = await Promise.all([
            getTeamInvites(event, teamID),
            getTeamMemberLimit(event),
        ]);

        return {
            invites: invites.map((invite) => ({
                id: invite.id,
                email: invite.email,
                expires_at: invite.expires_at
                    ? new Date(invite.expires_at as unknown as string | number).toISOString()
                    : null,
            })),
            max_team_members,
        } satisfies GetTeamInvitesResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
