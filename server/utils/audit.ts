import type { H3Event } from "h3";
import { getRequestHeader } from "h3";
import { adminAuditEvents } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";

export interface AuditEntry {
    action: string;
    entity_type: string;
    entity_id?: string | number | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
}

type AuditDatabase = Pick<DrizzleDatabase, "insert">;

/** Resolve the acting account that the auth middleware validated for this request. */
export function auditActorId(event: H3Event): number | null {
    return event.context.basisAuthValidatedUser?.user.id ?? event.context.oauth2?.user?.id ?? null;
}

function auditRequestId(event: H3Event): string | null {
    try {
        const header =
            getRequestHeader(event, "x-request-id") ?? getRequestHeader(event, "x-correlation-id");
        const value = header?.trim();
        return value ? value.slice(0, 200) : null;
    } catch {
        return null;
    }
}

/**
 * Append an immutable administrative audit row. Callers pass their transaction
 * so the record commits or rolls back with the change it describes.
 */
export async function writeAuditEvent(
    db: AuditDatabase,
    event: H3Event,
    entry: AuditEntry,
): Promise<void> {
    await db.insert(adminAuditEvents).values({
        actor_user_id: auditActorId(event),
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id:
            entry.entity_id === undefined || entry.entity_id === null
                ? null
                : String(entry.entity_id),
        before: entry.before ?? null,
        after: entry.after ?? null,
        reason: entry.reason ?? null,
        request_id: auditRequestId(event),
        created_at: new Date(),
    });
}
