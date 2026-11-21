import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeamEvaluationCounts } from "~~/server/utils/database/scores";
import { getEventState } from "~~/server/utils/event-state";
import { MIN_PUBLIC_FEEDBACK_REVIEWERS } from "~~/server/utils/score-feedback";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await optionalUser(event);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const team = await getTeam(event, id, true);

        if (!team) {
            throw createError({
                statusCode: 404,
                message: "Team '" + id + "' does not exist",
            });
        }

        const state = await getEventState(event);
        const viewerTeam = user?.team_id ? await getTeam(event, user.team_id) : null;
        // A pointer to an archived team still identifies the person as that
        // team's member for its historical detail page.
        const isMember = viewerTeam?.id === id || user?.team_id === id;
        const judgingStaff =
            hasNethackPermission(
                event.context.oauth2?.permissions,
                NethackPermissions.Judging.assignmentsRead,
            ) ||
            hasNethackPermission(
                event.context.oauth2?.permissions,
                NethackPermissions.Judging.resultsRead,
            );

        // Active-season projects stay private until submissions close. Only the
        // team itself and judging staff may inspect them before that point.
        if (
            team.season_id === state.season?.id &&
            !state.galleryPublic &&
            !isMember &&
            !judgingStaff
        ) {
            throw createError({
                statusCode: 404,
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

        // Draft submissions are private to the team and the judging staff.
        if (!team.project_submitted && !isMember && !privileged) {
            throw createError({
                statusCode: 404,
                message: "Team '" + id + "' does not exist",
            });
        }
        const withScore =
            privileged ||
            (isMember &&
                visibility.resultsPublished &&
                visibility.showScores &&
                meetsAnonymityThreshold);
        const withRank =
            privileged ||
            (visibility.resultsPublished && visibility.showRanking && meetsAnonymityThreshold);
        const awards = visibility.resultsPublished || privileged ? await getAwards(event, id) : [];

        return convertTeamToPublic(team, { withScore, withRank }, awards);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
