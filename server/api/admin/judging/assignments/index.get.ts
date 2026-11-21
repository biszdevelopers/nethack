import { and, asc, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgeAssignmentQuery } from "~~/shared/schemas";
import { judgeAssignments, users } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, JudgeAssignmentQuery.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const rows = await event.context.drizzle
            .select({
                id: judgeAssignments.id,
                season_id: judgeAssignments.season_id,
                judge_user_id: judgeAssignments.judge_user_id,
                pathway: judgeAssignments.pathway,
                team_id: judgeAssignments.team_id,
                created_at: judgeAssignments.created_at,
                judge_email: users.email,
                judge_name: users.name,
            })
            .from(judgeAssignments)
            .innerJoin(users, eq(judgeAssignments.judge_user_id, users.id))
            .where(
                query.id
                    ? and(
                          eq(judgeAssignments.season_id, season.id),
                          eq(judgeAssignments.id, query.id),
                      )
                    : eq(judgeAssignments.season_id, season.id),
            )
            .orderBy(asc(judgeAssignments.judge_user_id), asc(judgeAssignments.id));

        return {
            assignments: rows.map((row) => ({
                id: row.id,
                season_id: row.season_id,
                judge_user_id: row.judge_user_id,
                pathway: row.pathway,
                team_id: row.team_id,
                created_at: row.created_at.toISOString(),
                judge_email: row.judge_email,
                judge_name: row.judge_name,
            })),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
