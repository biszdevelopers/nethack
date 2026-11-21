import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { hackathon } from "~~/server/database/schema";
import { LIVE_OVERRIDE_KEYS, LiveOverrides } from "~~/shared/schemas";
import { firstRow, invalidateRequestCaches, requestCache } from "./query";
import { hackathonUsesYaml, readHackathonConfig } from "../hackathon-config";

/** Keep only operational values that intentionally differ from the manifest. */
export function pickDivergingLiveOverrides(
    manifest: Record<string, unknown> | null,
    settings: Record<string, unknown>,
    existing: Record<string, unknown> = {},
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...existing };
    const kept = Object.entries(next).filter(([key]) => {
        if (!(LIVE_OVERRIDE_KEYS as readonly string[]).includes(key)) return true;
        if (!Object.hasOwn(settings, key)) return true;
        return !(
            manifest &&
            Object.hasOwn(manifest, key) &&
            isDeepStrictEqual(manifest[key], settings[key])
        );
    });
    const overrides = Object.fromEntries(kept);
    for (const [key, value] of Object.entries(settings)) {
        if (!(LIVE_OVERRIDE_KEYS as readonly string[]).includes(key)) continue;
        if (manifest && Object.hasOwn(manifest, key) && isDeepStrictEqual(manifest[key], value)) {
            continue;
        }
        overrides[key] = value;
    }
    return overrides;
}

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

export function getHackathon(event: H3Event): Promise<Hackathon | null> {
    // Config is immutable within one request; write routes invalidate this via
    // invalidateHackathonCache before reading it again. Caching the promise
    // also collapses concurrent reads that start in the same tick.
    return requestCache(event, "hackathon", async () => {
        if (hackathonUsesYaml()) {
            const { rubric, ...settings } = await readHackathonConfig();
            // PostgreSQL owns the operational switches (status, voting, judging,
            // results, score/rank visibility) so the portal never needs a writable
            // manifest. Schedule, theme, and the rubric still come from the manifest.
            const overrides = await getLiveOverrides(event);
            return { ...settings, ...overrides, live_overrides: overrides };
        }
        const row = await firstRow(event.context.drizzle.select().from(hackathon).limit(1));
        return (row ?? null) as Hackathon | null;
    });
}

/** Call after a route mutates hackathon/seasons state it later reads back. */
export function invalidateHackathonCache(event: H3Event): void {
    delete event.context.cachedHackathon;
    invalidateRequestCaches(event);
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
