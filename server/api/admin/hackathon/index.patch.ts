import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
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

        // Strip null/undefined — they'd violate NOT NULL constraints
        const configFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawConfig)) {
            if (value !== null && value !== undefined) configFields[key] = value;
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
            // A local checkout's manifest is writable, so the portal stays
            // usable after a season is activated. Remote manifests are not.
            if (getHackathonConfigSource() !== "local") {
                throw createError({
                    statusCode: 409,
                    message: "Edit the configured HACKATHON.yml to change live settings.",
                });
            }

            await writeHackathonConfig(configFields);

            // Keep the database copies aligned for rollback and stored-season views.
            await event.context.drizzle
                .update(hackathon)
                .set(configFields)
                .where(eq(hackathon.id, 1));
            if (activeSeason) {
                await event.context.drizzle
                    .update(seasons)
                    .set(configFields)
                    .where(eq(seasons.id, activeSeason.id));
            }
        } else if (hackathonUsesYaml()) {
            // Historical and future seasons keep editable stored settings.
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
            await event.context.drizzle
                .update(hackathon)
                .set(configFields)
                .where(eq(hackathon.id, 1));

            if (activeSeason) {
                await event.context.drizzle
                    .update(seasons)
                    .set(configFields)
                    .where(eq(seasons.id, activeSeason.id));
            }
        }

        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
