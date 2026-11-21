import { and, eq } from "drizzle-orm";
import { NotificationIdParams } from "~~/shared/schemas";
import { notifications } from "~~/server/database/schema";
import { changedRows } from "~~/server/utils/database/query";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event);
        const { id } = await getValidatedRouterParams(event, NotificationIdParams.parse);

        const changed = await changedRows(
            event.context.drizzle
                .update(notifications)
                .set({ read_at: new Date() })
                .where(and(eq(notifications.id, id), eq(notifications.user_id, user.id)))
                .returning({ id: notifications.id }),
        );
        if (changed === 0) {
            throw createError({ statusCode: 404, message: "Notification not found" });
        }
        return { message: "Notification marked read" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
