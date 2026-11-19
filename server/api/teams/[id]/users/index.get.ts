import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getTeamById } from "~~/server/utils/database/teams";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { getAllTeamMembers, getTeamMembers } from "~~/server/utils/database/members";
import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const requester = await requireUser(event);

        const team = await getTeamById(event, teamID);
        if (!team) throw createError({ statusCode: 404, message: "Team not found" });

        // Member emails are visible only to the current roster and to portal
        // administrators. A former member sees no PII after leaving.
        if (requester.team_id !== teamID) {
            await requireUser(event, NethackPermissions.all);
        }

        const activeSeason = await getActiveSeason(event);
        const isOldTeam = activeSeason && team.season_id !== activeSeason.id;

        const members = isOldTeam
            ? await getAllTeamMembers(event, teamID)
            : await getTeamMembers(event, teamID);

        return members.map((user) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            team_id: user.team_id,
        })) satisfies GetTeamMembersResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
