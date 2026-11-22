import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "~~/server/database/schema";
import { requireUser } from "~~/server/utils/auth";
import { writeAuditEvent } from "~~/server/utils/audit";
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
            const [row] = await tx
                .update(users)
                .set({ is_judge: body.is_judge ? 1 : 0 })
                .where(eq(users.id, id))
                .returning({ id: users.id, is_judge: users.is_judge });
            if (!row) {
                throw createError({ statusCode: 404, message: "User not found" });
            }
            await writeAuditEvent(tx, event, {
                action: "user.judge",
                entity_type: "user",
                entity_id: id,
                before: { is_judge: body.is_judge ? 0 : 1 },
                after: { is_judge: Boolean(row.is_judge) },
            });
            return row;
        });

        return { id: updated.id, is_judge: Boolean(updated.is_judge) };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
