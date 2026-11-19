import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { hackathon } from "~~/server/database/schema";
import { firstRow } from "./query";

export async function getHackathon(event: H3Event): Promise<Hackathon | null> {
    if (event.context.cachedHackathon !== undefined) return event.context.cachedHackathon;

    const row = await firstRow(event.context.drizzle.select().from(hackathon).limit(1));
    const result = (row ?? null) as Hackathon | null;

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
    await event.context.drizzle.update(hackathon).set(data).where(eq(hackathon.id, 1));
    invalidateHackathonCache(event);

    return getHackathon(event);
}
