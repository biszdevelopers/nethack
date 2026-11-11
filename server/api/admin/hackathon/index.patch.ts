import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { getActiveSeason, getSeasons } from "~~/server/utils/database/seasons";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Hackathon.update);

        const body = await readValidatedBody(event, AdminUpdateHackathonRequest.parse);

        if (Object.keys(body).length === 0) {
            throw createError({
                statusCode: 400,
                message: "No fields to update",
            });
        }

        // Extract season_id — it's a routing hint, not a config field
        const { season_id, ...rawConfig } = body as Record<string, any>;

        // Strip null/undefined — they'd violate NOT NULL constraints
        const configFields: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawConfig)) {
            if (v !== null && v !== undefined) configFields[k] = v;
        }

        if (Object.keys(configFields).length === 0) {
            throw createError({
                statusCode: 400,
                message: "No fields to update",
            });
        }

        if (season_id !== undefined) {
            // Per-season save: write to the specified season,
            // and also to the global row if this is the active season
            await event.context.drizzle
                .update(seasons)
                .set(configFields)
                .where(eq(seasons.id, season_id));

            const active = await getActiveSeason(event);
            if (active && active.id === season_id) {
                await event.context.drizzle
                    .update(hackathon)
                    .set(configFields)
                    .where(eq(hackathon.id, 1));
            }
        } else {
            // No season — write only to the global hackathon row
            await event.context.drizzle
                .update(hackathon)
                .set(configFields)
                .where(eq(hackathon.id, 1));
        }

        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
