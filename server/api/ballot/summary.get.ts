import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { requireUser } from "~~/server/utils/auth";
import { getJudgeScope, judgeScopeWhere } from "~~/server/utils/judging";
import { seasons, teams, teamScores } from "~~/server/database/schema";
import { eq, and, sql, ne, count, countDistinct } from "drizzle-orm";

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

        // The judging queue only contains this judge's active, submitted,
        // assigned projects. Progress must use that same universe or a scoped
        // judge never reaches completion.
        if (activeSeason) {
            const scope = await getJudgeScope(event.context.drizzle, activeSeason.id, user.id);
            const scopedWhere = and(
                eq(teams.season_id, activeSeason.id),
                eq(teams.project_submitted, 1),
                eq(teams.status, "active"),
                ne(teams.id, user.team_id ?? -1),
                judgeScopeWhere(scope),
            );
            const [submittedRows, scoredRows] = await Promise.all([
                event.context.drizzle.select({ value: count() }).from(teams).where(scopedWhere),
                event.context.drizzle
                    .select({ value: countDistinct(teamScores.team_id) })
                    .from(teamScores)
                    .innerJoin(teams, eq(teams.id, teamScores.team_id))
                    .where(
                        and(
                            scopedWhere,
                            eq(teamScores.season_id, activeSeason.id),
                            eq(teamScores.judge_user_id, user.id),
                        ),
                    ),
            ]);
            current = {
                season_id: activeSeason.id,
                season_name: activeSeason.name,
                // The aggregate query selects every season, so the active row is
                // always present; keep its all-team project count.
                project_count: (current as BallotSummaryItem).project_count,
                submitted_count: Number(submittedRows[0]!.value),
                scored_count: Number(scoredRows[0]!.value),
            };
        }

        return { current, past } satisfies GetBallotSummaryResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
