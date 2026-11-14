import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeamEvaluationCounts } from "~~/server/utils/database/scores";
import { MIN_PUBLIC_FEEDBACK_REVIEWERS } from "~~/server/utils/score-feedback";

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

        // Dev-portal users always see scores and ranks. Participant results require
        // publication, the season toggle, and enough evaluations to protect judge anonymity.
        const resolveVisibility = await getScoreRankVisibilityResolver(event);
        const visibility = resolveVisibility(team.season_id);
        const evaluationsByTeam = await getTeamEvaluationCounts(event, [team.id]);
        const meetsAnonymityThreshold =
            (evaluationsByTeam.get(team.id) ?? 0) >= MIN_PUBLIC_FEEDBACK_REVIEWERS;
        const privileged = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.Judging.resultsRead,
        );
        const withScore =
            privileged ||
            (isMember &&
                visibility.resultsPublished &&
                visibility.showScores &&
                meetsAnonymityThreshold);
        const withRank =
            privileged ||
            (visibility.resultsPublished && visibility.showRanking && meetsAnonymityThreshold);
        const awards = await getAwards(event, id);

        return convertTeamToPublic(team, { withScore, withRank }, awards);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
