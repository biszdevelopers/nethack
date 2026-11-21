import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgeAssignmentQuery } from "~~/shared/schemas";
import { judgeAssignments } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, JudgeAssignmentQuery.parse);
        if (!query.id) throw createError({ statusCode: 400, message: "Assignment id is required" });

        await event.context.drizzle.transaction(async (tx) => {
            const deleted = await firstRow(
                tx.delete(judgeAssignments).where(eq(judgeAssignments.id, query.id!)).returning(),
            );
            if (!deleted) throw createError({ statusCode: 404, message: "Assignment not found" });
            await writeAuditEvent(tx, event, {
                action: "judging.assignment.delete",
                entity_type: "season",
                entity_id: deleted.season_id,
                before: deleted,
            });
        });

        return { message: "Assignment removed" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
