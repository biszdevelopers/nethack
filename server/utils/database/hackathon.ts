import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { hackathon } from "~~/server/database/schema";
import { LiveOverrides } from "~~/shared/schemas";
import { firstRow } from "./query";
import { hackathonUsesYaml, readHackathonConfig } from "../hackathon-config";

/** Merge stored operational overrides with an incoming partial update. */
export function mergeLiveOverrides(stored: unknown, incoming: LiveOverrides): LiveOverrides {
    // PostgreSQL jsonb returns an object; SQLite fixtures store JSON text.
    let value = stored;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return { ...incoming };
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ...incoming };
    }
    return { ...(value as LiveOverrides), ...incoming };
}

/** Portal-managed switches that apply on top of a YAML manifest. */
export async function getLiveOverrides(event: H3Event): Promise<LiveOverrides> {
    const row = await firstRow(
        event.context.drizzle
            .select({ live_overrides: hackathon.live_overrides })
            .from(hackathon)
            .limit(1),
    );
    // PostgreSQL jsonb returns an object; SQLite test fixtures store JSON text.
    // Accept both so tests exercise the same override application as production.
    const stored = row?.live_overrides;
    let value: unknown = stored ?? {};
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return {};
        }
    }
    const parsed = LiveOverrides.safeParse(value);
    return parsed.success ? parsed.data : {};
}

export async function getHackathon(event: H3Event): Promise<Hackathon | null> {
    if (event.context.cachedHackathon !== undefined) return event.context.cachedHackathon;

    let result: Hackathon | null;
    if (hackathonUsesYaml()) {
        const { rubric, ...settings } = await readHackathonConfig();
        // PostgreSQL owns the operational switches (status, voting, judging,
        // results, score/rank visibility) so the portal never needs a writable
        // manifest. Schedule, theme, and the rubric still come from the manifest.
        const overrides = await getLiveOverrides(event);
        result = { ...settings, ...overrides, live_overrides: overrides };
    } else {
        const row = await firstRow(event.context.drizzle.select().from(hackathon).limit(1));
        result = (row ?? null) as Hackathon | null;
    }

    // Config is immutable within one request; write routes invalidate this via
    // invalidateHackathonCache before reading it again.
    event.context.cachedHackathon = result;
    return result;
}

/** Call after a route mutates hackathon/seasons state it later reads back. */
export function invalidateHackathonCache(event: H3Event): void {
    delete event.context.cachedHackathon;
}

export async function updateHackathon(
    event: H3Event,
    data: Partial<Omit<Hackathon, "id" | "submitted_count">>,
): Promise<Hackathon | null> {
    if (hackathonUsesYaml()) {
        throw createError({
            statusCode: 409,
            message: "Edit the configured HACKATHON.yml to change live settings.",
        });
    }
    await event.context.drizzle.update(hackathon).set(data).where(eq(hackathon.id, 1));
    invalidateHackathonCache(event);

    return getHackathon(event);
}
