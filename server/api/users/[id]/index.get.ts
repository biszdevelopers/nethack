import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getUserPastTeams } from "~~/server/utils/database/members";
import { getTeamById, getTeam } from "~~/server/utils/database/teams";
import { UserIdParams } from "~~/shared/schemas";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";
import { getTeamEvaluationCounts } from "~~/server/utils/database/scores";
import { MIN_PUBLIC_FEEDBACK_REVIEWERS } from "~~/server/utils/score-feedback";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const currentUser = await optionalUser(event);

        const { id } = await getValidatedRouterParams(event, UserIdParams.parse);
        const isSelf = currentUser?.id === id;

        const user = await getUser(event, id);
        if (!user) {
            throw createError({
                status: 404,
                message: "User not found",
            });
        }

        if (!isSelf) {
            // Public profile details omit contact information and team membership.
            return convertUserToPublic(user, {
                includeEmail: false,
                includeTeam: false,
            }) satisfies APIUser;
        }

        // Self view: return full GetUserResponse. `team` is the active-season
        // membership only; a pointer left over from an earlier season becomes
        // history so a returning participant can join a new team normally.
        const team = user.team_id ? await getTeam(event, user.team_id) : null;
        const pastTeams = await getUserPastTeams(event, id);
        if (user.team_id && !team) {
            const staleTeam = await getTeamById(event, user.team_id);
            if (staleTeam && !pastTeams.some((past) => past.id === staleTeam.id)) {
                pastTeams.unshift(staleTeam);
            }
        }

        const allTeamIds = [...(team ? [team.id] : []), ...pastTeams.map((t) => t.id)];
        const awardsByTeam = await getAwardsForTeams(event, allTeamIds);
        const evaluationsByTeam = await getTeamEvaluationCounts(event, allTeamIds);

        // Scores and ranks are only shown to participants when the toggles of
        // each team's own season are enabled; dev-portal users always see them.
        const resolveVisibility = await getScoreRankVisibilityResolver(event);
        const privileged = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.Judging.resultsRead,
        );
        const optionsFor = (t: Team) => {
            const visibility = resolveVisibility(t.season_id);
            const meetsAnonymityThreshold =
                (evaluationsByTeam.get(t.id) ?? 0) >= MIN_PUBLIC_FEEDBACK_REVIEWERS;
            return {
                withScore:
                    privileged ||
                    (visibility.resultsPublished &&
                        visibility.showScores &&
                        meetsAnonymityThreshold),
                withRank:
                    privileged ||
                    (visibility.resultsPublished &&
                        visibility.showRanking &&
                        meetsAnonymityThreshold),
            };
        };

        // Awards reveal winners, so participants see them only after that
        // team's season publishes results; privileged users always see them.
        const awardsFor = (t: Team) =>
            privileged || resolveVisibility(t.season_id).resultsPublished
                ? (awardsByTeam[t.id] ?? [])
                : [];

        return {
            ...convertUserToPublic(user),
            team: team && convertTeamToPublic(team, optionsFor(team), awardsFor(team)),
            past_teams: pastTeams.map((t) => convertTeamToPublic(t, optionsFor(t), awardsFor(t))),
        } satisfies GetUserResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
