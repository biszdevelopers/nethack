import { NethackPermissions } from "~~/shared/permissions";
import { TeamInviteIdParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        const { id } = await getValidatedRouterParams(event, TeamInviteIdParams.parse);

        const hackathon = await getHackathon(event);
        if (hackathon?.status !== "not_started" && hackathon?.status !== "in_progress") {
            throw createError({
                status: 403,
                message: "Cannot join a team after the hackathon has finished",
            });
        }

        const team = await acceptTeamInvite(event, id, user);

        return { message: `You joined ${team.name}` };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
