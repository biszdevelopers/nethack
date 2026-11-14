import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await optionalUser(event);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const isMember = user?.team_id === id;

        const team = await getTeam(event, id, true);

        if (!team) {
            throw createError({
                status: 404,
                message: "Team '" + id + "' does not exist",
            });
        }

        // Dev-portal users always see scores and ranks; team members and other
        // participants only see them when the team's own season toggles are enabled.
        const resolveVisibility = await getScoreRankVisibilityResolver(event);
        const visibility = resolveVisibility(team.season_id);
        const privileged = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.Judging.resultsRead,
        );
        const withScore = privileged || (isMember && visibility.showScores);
        const withRank = privileged || visibility.showRanking;
        const awards = await getAwards(event, id);

        return convertTeamToPublic(team, { withScore, withRank }, awards);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
