import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { requireUser } from "~~/server/utils/auth";
import { seasons, teams, teamScores } from "~~/server/database/schema";
import { eq, and, sql, ne } from "drizzle-orm";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Judging.assignmentsRead);

        const results = await event.context.drizzle
            .select({
                season_id: seasons.id,
                season_name: seasons.name,
                project_count: sql<number>`COUNT(DISTINCT ${teams.id})`.mapWith(Number),
                submitted_count:
                    sql<number>`COUNT(DISTINCT CASE WHEN ${teams.project_submitted} = 1 THEN ${teams.id} END)`.mapWith(
                        Number,
                    ),
                scored_count:
                    sql<number>`COUNT(DISTINCT CASE WHEN ${teams.project_submitted} = 1 THEN ${teamScores.team_id} END)`.mapWith(
                        Number,
                    ),
            })
            .from(seasons)
            .leftJoin(teams, and(eq(teams.season_id, seasons.id), ne(teams.id, user.team_id ?? -1)))
            .leftJoin(
                teamScores,
                and(eq(teamScores.team_id, teams.id), eq(teamScores.judge_user_id, user.id)),
            )
            .groupBy(seasons.id)
            .orderBy(seasons.id);

        const activeSeason = await getActiveSeason(event);
        const activeSeasonId = activeSeason?.id ?? null;

        let current: BallotSummaryItem | null = null;
        const past: BallotSummaryItem[] = [];

        for (const item of results) {
            if (item.season_id === activeSeasonId) {
                current = item;
            } else {
                past.push(item);
            }
        }

        return { current, past } satisfies GetBallotSummaryResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
