import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getTeamById, getTeam } from "~~/server/utils/database/teams";
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
        // administrators. A stale membership pointer from an earlier season
        // must not grant access to another active team's roster.
        const currentTeam = requester.team_id ? await getTeam(event, requester.team_id) : null;
        if (currentTeam?.id !== teamID) {
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
