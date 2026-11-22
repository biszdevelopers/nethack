import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { seasons, teams, users } from "~~/server/database/schema";
import { requireUser } from "~~/server/utils/auth";
import { writeAuditEvent } from "~~/server/utils/audit";
import { firstRow, lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { UserIdParams } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

const SetJudgeRequest = z.object({
    is_judge: z.boolean(),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, UserIdParams.parse);
        const body = await readValidatedBody(event, SetJudgeRequest.parse);

        const updated = await event.context.drizzle.transaction(async (tx) => {
            const current = await firstRow(
                lockForUpdateIfSupported(
                    tx
                        .select({ team_id: users.team_id, is_judge: users.is_judge })
                        .from(users)
                        .where(eq(users.id, id))
                        .limit(1),
                ),
            );
            if (!current) {
                throw createError({ statusCode: 404, message: "User not found" });
            }
            if (body.is_judge && current.team_id) {
                const competing = await firstRow(
                    tx
                        .select({ id: teams.id })
                        .from(teams)
                        .innerJoin(seasons, eq(seasons.id, teams.season_id))
                        .where(and(eq(teams.id, current.team_id), eq(seasons.is_active, 1)))
                        .limit(1),
                );
                if (competing) {
                    throw createError({
                        statusCode: 409,
                        message: "A competing participant cannot be a judge",
                    });
                }
            }
            await tx
                .update(users)
                .set({ is_judge: body.is_judge ? 1 : 0 })
                .where(eq(users.id, id));
            await writeAuditEvent(tx, event, {
                action: "user.judge",
                entity_type: "user",
                entity_id: id,
                before: { is_judge: Boolean(current.is_judge) },
                after: { is_judge: body.is_judge },
            });
            return { id, is_judge: body.is_judge };
        });

        return { id: updated.id, is_judge: Boolean(updated.is_judge) };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
