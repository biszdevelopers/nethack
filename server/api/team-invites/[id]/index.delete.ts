import { NethackPermissions } from "~~/shared/permissions";
import { TeamInviteIdParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        const { id } = await getValidatedRouterParams(event, TeamInviteIdParams.parse);

        await declineTeamInvite(event, id, user.email);

        return { message: "Invitation declined" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
