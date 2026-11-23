import { and, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { TeamAwardParams } from "~~/shared/schemas";
import { teamAwards } from "~~/server/database/schema";
import { changedRows } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id, award } = await getValidatedRouterParams(event, TeamAwardParams.parse);

        await event.context.drizzle.transaction(async (tx) => {
            const deleted = await changedRows(
                tx
                    .delete(teamAwards)
                    .where(and(eq(teamAwards.team_id, id), eq(teamAwards.award, award)))
                    .returning({ team_id: teamAwards.team_id }),
            );
            if (deleted === 0) {
                throw createError({ statusCode: 404, message: "Team award not found." });
            }
            await writeAuditEvent(tx, event, {
                action: "team.award.remove",
                entity_type: "team",
                entity_id: id,
                before: { award },
            });
        });

        return { message: "Award removed" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
