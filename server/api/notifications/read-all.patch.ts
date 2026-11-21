import { and, eq, isNull } from "drizzle-orm";
import { notifications } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event);
        await event.context.drizzle
            .update(notifications)
            .set({ read_at: new Date() })
            .where(and(eq(notifications.user_id, user.id), isNull(notifications.read_at)));
        return { message: "All notifications marked read" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
