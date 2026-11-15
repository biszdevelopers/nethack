import { and, eq } from "drizzle-orm";
import { TeamIdParams } from "~~/shared/schemas";
import { getTeamById } from "~~/server/utils/database/teams";
import { getSeasonById } from "~~/server/utils/database/seasons";
import { userPastTeams } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { getTeamScoreFeedback } from "~~/server/utils/score-feedback";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamId } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const user = await requireUser(event);
        const team = await getTeamById(event, teamId);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });

        const isCurrentMember = user.team_id === team.id;
        const pastMembership = isCurrentMember
            ? undefined
            : await firstRow(
                  event.context.drizzle
                      .select()
                      .from(userPastTeams)
                      .where(
                          and(
                              eq(userPastTeams.user_id, user.id),
                              eq(userPastTeams.team_id, team.id),
                          ),
                      )
                      .limit(1),
              );
        if (!isCurrentMember && !pastMembership) {
            throw createError({ statusCode: 404, message: "Team not found." });
        }

        const season = await getSeasonById(event, team.season_id);
        if (!season?.results_published) {
            throw createError({ statusCode: 403, message: "Judge feedback is not published yet." });
        }
        const result = await getTeamScoreFeedback(event, team, { publicView: true });
        const scoresVisible = Boolean(
            season.show_scores && !result.feedback_withheld_for_anonymity,
        );
        const rankVisible = Boolean(season.show_ranking && !result.feedback_withheld_for_anonymity);

        const response: TeamScoreFeedbackResponse = {
            ...result,
            original_score: scoresVisible ? result.original_score : null,
            displayed_score: scoresVisible ? result.displayed_score : null,
            curve_preset: scoresVisible ? result.curve_preset : null,
            curve_label: scoresVisible ? result.curve_label : null,
            rank: rankVisible ? result.rank : null,
        };
        return response;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
