import { and, count, desc, eq, isNull } from "drizzle-orm";
import { NotificationsQuery } from "~~/shared/schemas";
import { notifications } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event);
        const query = await getValidatedQuery(event, NotificationsQuery.parse);

        const [rows, unreadRows] = await Promise.all([
            event.context.drizzle
                .select()
                .from(notifications)
                .where(eq(notifications.user_id, user.id))
                .orderBy(desc(notifications.created_at), desc(notifications.id))
                .limit(query.limit),
            event.context.drizzle
                .select({ value: count() })
                .from(notifications)
                .where(and(eq(notifications.user_id, user.id), isNull(notifications.read_at))),
        ]);

        return {
            notifications: rows.map((row) => ({
                id: row.id,
                type: row.type,
                title: row.title,
                body: row.body,
                link: row.link,
                read_at: row.read_at ? row.read_at.toISOString() : null,
                created_at: row.created_at.toISOString(),
            })),
            unread: Number(unreadRows[0]?.value ?? 0),
        } satisfies GetNotificationsResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
