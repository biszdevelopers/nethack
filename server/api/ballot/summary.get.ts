import { NethackPermissions } from "~~/shared/permissions";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { requireUser } from "~~/server/utils/auth";
import { seasons, teams, teamScores } from "~~/server/database/schema";
import { eq, and, sql } from "drizzle-orm";

export default defineEventHandler(async (event) => {
    const user = await requireUser(event, NethackPermissions.Judging.assignmentsRead);

    const results = await event.context.drizzle
        .select({
            season_id: seasons.id,
            season_name: seasons.name,
            project_count: sql<number>`COUNT(DISTINCT ${teams.id})`,
            submitted_count: sql<number>`COUNT(DISTINCT CASE WHEN ${teams.project_submitted} = 1 THEN ${teams.id} END)`,
            scored_count: sql<number>`COUNT(DISTINCT ${teamScores.team_id})`,
        })
        .from(seasons)
        .leftJoin(teams, eq(teams.season_id, seasons.id))
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
});
