import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgeRecusalRequest } from "~~/shared/schemas";
import { judgeRecusals, teams } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
        const body = await readValidatedBody(event, JudgeRecusalRequest.parse);
        const season = body.season_id
            ? await getSeasonById(event, body.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const team = await firstRow(
            event.context.drizzle
                .select({ id: teams.id, season_id: teams.season_id })
                .from(teams)
                .where(eq(teams.id, body.team_id))
                .limit(1),
        );
        if (!team || team.season_id !== season.id) {
            throw createError({ statusCode: 404, message: "Team not found in this season" });
        }

        await event.context.drizzle.transaction(async (tx) => {
            await tx
                .insert(judgeRecusals)
                .values({
                    season_id: season.id,
                    judge_user_id: judge.id,
                    team_id: team.id,
                    reason: body.reason ?? null,
                    created_at: new Date(),
                })
                .onConflictDoUpdate({
                    target: [
                        judgeRecusals.season_id,
                        judgeRecusals.judge_user_id,
                        judgeRecusals.team_id,
                    ],
                    set: { reason: body.reason ?? null },
                });
            await writeAuditEvent(tx, event, {
                action: "judging.recusal",
                entity_type: "team",
                entity_id: team.id,
                after: { judge_user_id: judge.id, reason: body.reason ?? null },
            });
        });

        return { message: "Recusal recorded" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
