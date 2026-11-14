import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { hackathon } from "~~/server/database/schema";
import { firstRow } from "./query";
import { hackathonUsesYaml, readHackathonConfig } from "../hackathon-config";

export async function getHackathon(event: H3Event): Promise<Hackathon | null> {
    if (hackathonUsesYaml()) return readHackathonConfig();
    const row = await firstRow(event.context.drizzle.select().from(hackathon).limit(1));

    return (row ?? null) as Hackathon | null;
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

    return getHackathon(event);
}
