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
        const result = await getTeamScoreFeedback(event, team);

        return {
            ...result,
            original_score: season.show_scores ? result.original_score : null,
            displayed_score: season.show_scores ? result.displayed_score : null,
            curve_preset: season.show_scores ? result.curve_preset : null,
            curve_label: season.show_scores ? result.curve_label : null,
            rank: season.show_ranking ? result.rank : null,
            feedback: result.feedback.map(({ scores, normalized_score, criteria, ...entry }) => ({
                ...entry,
                scores: season.show_scores ? scores : null,
                normalized_score: season.show_scores ? normalized_score : null,
                criteria: season.show_scores ? criteria : null,
            })),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
