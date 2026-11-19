import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { invalidateHackathonCache } from "~~/server/utils/database/hackathon";
import { acquireActivationLock, getSeasons } from "~~/server/utils/database/seasons";
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

        // Keep explicit nulls: the schema and DB both allow clearing these
        // text fields. Only undefined means "not provided".
        const configFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawConfig)) {
            if (value !== undefined) configFields[key] = value;
        }

        if (Object.keys(configFields).length === 0) {
            throw createError({
                statusCode: 400,
                message: "No fields to update",
            });
        }

        await event.context.drizzle.transaction(async (tx) => {
            // Serialize with season activation so settings cannot land on the wrong live season.
            await acquireActivationLock(tx);
            const [activeSeason] = await tx
                .select({ id: seasons.id })
                .from(seasons)
                .where(eq(seasons.is_active, 1))
                .limit(1);
            const targetId = season_id ?? activeSeason?.id;
            if (season_id !== undefined && season_id !== activeSeason?.id) {
                await requireUser(event, NethackPermissions.Seasons.update);
            }
            if (targetId !== undefined) {
                const updated = await tx
                    .update(seasons)
                    .set(configFields)
                    .where(eq(seasons.id, targetId))
                    .returning({ id: seasons.id });
                if (updated.length === 0) {
                    throw createError({ statusCode: 404, message: "Season not found" });
                }
            }
            if (season_id === undefined || season_id === activeSeason?.id) {
                await tx.update(hackathon).set(configFields).where(eq(hackathon.id, 1));
            }
        });

        invalidateHackathonCache(event);
        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
