import { and, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminTeamScoreParams } from "~~/shared/schemas";
import { seasons, teamScores } from "~~/server/database/schema";
import { getTeamById } from "~~/server/utils/database/teams";
import { getAwardsForTeams } from "~~/server/utils/database/awards";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id, judgeId } = await getValidatedRouterParams(event, AdminTeamScoreParams.parse);
        const team = await getTeamById(event, id);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });

        const ranked = await event.context.drizzle.transaction(async (tx) => {
            await lockForUpdateIfSupported(
                tx
                    .select({ id: seasons.id })
                    .from(seasons)
                    .where(eq(seasons.id, team.season_id))
                    .limit(1),
            );
            const deleted = await tx
                .delete(teamScores)
                .where(and(eq(teamScores.team_id, id), eq(teamScores.judge_user_id, judgeId)))
                .returning({
                    team_id: teamScores.team_id,
                    judge_user_id: teamScores.judge_user_id,
                    season_id: teamScores.season_id,
                    scores: teamScores.scores,
                });
            if (deleted.length === 0) {
                throw createError({ statusCode: 404, message: "Evaluation not found." });
            }

            const standings = await calculateSeasonScoresWithDatabase(tx, team.season_id, true);
            await writeAuditEvent(tx, event, {
                action: "score.delete",
                entity_type: "team_score",
                entity_id: `${id}:${judgeId}`,
                before: deleted[0],
                reason: "administrator voided an evaluation",
            });
            return standings;
        });

        const awardsByTeam = await getAwardsForTeams(
            event,
            ranked.map((row) => row.id),
        );
        const standings = ranked.map((row) => ({
            team_id: row.id,
            name: row.name,
            pathway: row.pathway,
            status: row.status,
            score_exact: row.score_exact,
            score: row.score,
            rank: row.rank,
            awards: (awardsByTeam[row.id] ?? []).map((award) => award.name),
            project_name: row.project_name,
            project_demo_url: row.project_demo_url,
            project_repo_url: row.project_repo_url,
        })) satisfies AdminStandingRow[];

        return { season_id: team.season_id, standings };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
