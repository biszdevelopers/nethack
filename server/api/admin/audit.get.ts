import { and, desc, eq, or, sql } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminAuditQuery } from "~~/shared/schemas";
import { adminAuditEvents } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, AdminAuditQuery.parse);

        const events = await event.context.drizzle
            .select()
            .from(adminAuditEvents)
            .where(
                query.season_id === undefined
                    ? undefined
                    : or(
                          and(
                              eq(adminAuditEvents.entity_type, "season"),
                              eq(adminAuditEvents.entity_id, String(query.season_id)),
                          ),
                          sql`${adminAuditEvents.after}->>'season_id' = ${String(query.season_id)}`,
                      ),
            )
            .orderBy(desc(adminAuditEvents.created_at), desc(adminAuditEvents.id))
            .limit(query.limit);

        return {
            events: events.map((row) => ({
                id: row.id,
                actor_user_id: row.actor_user_id,
                action: row.action,
                entity_type: row.entity_type,
                entity_id: row.entity_id,
                before: row.before ?? null,
                after: row.after ?? null,
                reason: row.reason,
                request_id: row.request_id,
                created_at: row.created_at.toISOString(),
            })),
        } satisfies GetAdminAuditResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
