import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest, LIVE_OVERRIDE_KEYS } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { getLiveOverrides, invalidateHackathonCache } from "~~/server/utils/database/hackathon";
import { getSeasons } from "~~/server/utils/database/seasons";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import {
    getHackathonConfigSource,
    hackathonUsesYaml,
    writeHackathonConfig,
} from "~~/server/utils/hackathon-config";

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

        const [activeSeason] = await event.context.drizzle
            .select({ id: seasons.id })
            .from(seasons)
            .where(eq(seasons.is_active, 1))
            .limit(1);
        const targetsLiveSettings = season_id === undefined || season_id === activeSeason?.id;

        if (hackathonUsesYaml() && targetsLiveSettings) {
            const operational: Record<string, unknown> = {};
            const statics: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(configFields)) {
                if ((LIVE_OVERRIDE_KEYS as readonly string[]).includes(key)) {
                    operational[key] = value;
                } else {
                    statics[key] = value;
                }
            }

            // Schedule and theme still come from the manifest; status and the
            // visibility switches live in PostgreSQL, so they need no writable
            // manifest and stay editable even when it is hosted remotely.
            if (Object.keys(statics).length > 0) {
                if (getHackathonConfigSource() !== "local") {
                    throw createError({
                        statusCode: 409,
                        message:
                            "Schedule and theme come from the remote HACKATHON.yml. Only status and visibility switches can change here.",
                    });
                }
                await writeHackathonConfig(statics);
            }

            const overrides = { ...(await getLiveOverrides(event)), ...operational };
            // Keep the same lock order as season activation: seasons first,
            // then hackathon. The reverse order can deadlock concurrent writes.
            if (activeSeason) {
                await event.context.drizzle
                    .update(seasons)
                    .set({ ...statics, ...operational })
                    .where(eq(seasons.id, activeSeason.id));
            }
            await event.context.drizzle
                .update(hackathon)
                .set({ ...statics, ...operational, live_overrides: overrides })
                .where(eq(hackathon.id, 1));
        } else if (hackathonUsesYaml()) {
            // Historical and future seasons keep editable stored settings, but
            // editing them is a season-level change, not a live-event change.
            await requireUser(event, NethackPermissions.Seasons.update);
            const updatedSeasons = await event.context.drizzle
                .update(seasons)
                .set(configFields)
                .where(eq(seasons.id, season_id!))
                .returning({ id: seasons.id });
            if (updatedSeasons.length === 0) {
                throw createError({ statusCode: 404, message: "Season not found" });
            }
        } else if (season_id !== undefined) {
            // Per-season save: write to the specified season,
            // and also to the global row if this is the active season
            if (activeSeason?.id !== season_id) {
                await requireUser(event, NethackPermissions.Seasons.update);
            }
            const updatedSeasons = await event.context.drizzle
                .update(seasons)
                .set(configFields)
                .where(eq(seasons.id, season_id))
                .returning({ id: seasons.id });
            if (updatedSeasons.length === 0) {
                throw createError({ statusCode: 404, message: "Season not found" });
            }

            if (activeSeason?.id === season_id) {
                await event.context.drizzle
                    .update(hackathon)
                    .set(configFields)
                    .where(eq(hackathon.id, 1));
            }
        } else {
            // No season — write the global row and mirror it onto the active
            // season so public visibility resolvers see the same settings.
            // Seasons first, then hackathon, matching activation's lock order.
            if (activeSeason) {
                await event.context.drizzle
                    .update(seasons)
                    .set(configFields)
                    .where(eq(seasons.id, activeSeason.id));
            }
            await event.context.drizzle
                .update(hackathon)
                .set(configFields)
                .where(eq(hackathon.id, 1));
        }

        invalidateHackathonCache(event);
        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
