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

// Audit rows stay readable and bounded even when a caller supplies a full
// season row or a project description. The administrative page never needs
// unbounded participant text.
const MAX_AUDIT_STRING = 500;
const MAX_AUDIT_KEYS = 100;
const MAX_AUDIT_DEPTH = 4;
const MAX_AUDIT_JSON = 16_000;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.slice(0, MAX_AUDIT_STRING);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Date) return value.toISOString();
    if (depth >= MAX_AUDIT_DEPTH) return "[truncated]";
    if (Array.isArray(value)) {
        return value.slice(0, MAX_AUDIT_KEYS).map((item) => sanitizeAuditValue(item, depth + 1));
    }
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, MAX_AUDIT_KEYS)) {
            result[key.slice(0, 100)] = sanitizeAuditValue(item, depth + 1);
        }
        return result;
    }
    return String(value).slice(0, MAX_AUDIT_STRING);
}

function sanitizeAuditPayload(
    payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!payload) return null;
    const safe = sanitizeAuditValue(payload) as Record<string, unknown>;
    const serialized = JSON.stringify(safe);
    if (serialized.length <= MAX_AUDIT_JSON) return safe;
    return { truncated: true, preview: serialized.slice(0, MAX_AUDIT_JSON) };
}

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
        before: sanitizeAuditPayload(entry.before),
        after: sanitizeAuditPayload(entry.after),
        reason: entry.reason ? entry.reason.slice(0, MAX_AUDIT_STRING) : null,
        request_id: auditRequestId(event),
        created_at: new Date(),
    });
}
