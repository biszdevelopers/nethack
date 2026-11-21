import { NethackPermissions } from "~~/shared/permissions";
import { TeamInviteTokenParams } from "~~/shared/schemas";
import { getEventState } from "~~/server/utils/event-state";
import { acceptTeamInviteByToken } from "~~/server/utils/database/members";
import { notifyTeamOwner } from "~~/server/utils/notifications";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        const { token } = await getValidatedRouterParams(event, TeamInviteTokenParams.parse);

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                statusCode: 403,
                message: state.paused
                    ? "The event is paused"
                    : "Cannot join a team after submissions close",
            });
        }

        const team = await acceptTeamInviteByToken(event, token, user);
        await notifyTeamOwner(event, team, {
            type: "team_invite_accepted",
            title: `${user.name ?? user.email} joined ${team.name}`,
            body: "A member accepted your team invitation.",
            link: `/dashboard/teams/${team.id}`,
        });

        return { message: `You joined ${team.name}` };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
