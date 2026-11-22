import { NethackPermissions } from "~~/shared/permissions";
import { UpdateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow, isUniqueViolation } from "~~/server/utils/database/query";
import { setActiveSeason } from "~~/server/utils/database/seasons";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);

        const body = await readValidatedBody(event, UpdateSeasonRequest.parse);

        const existing = await firstRow(
            event.context.drizzle.select().from(seasons).where(eq(seasons.id, body.id)).limit(1),
        );

        if (!existing) {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }

        const { id, is_active, ...updateFields } = body;
        if (is_active === undefined && Object.keys(updateFields).length === 0) {
            throw createError({
                statusCode: 400,
                message: "No fields to update",
            });
        }

        // Switching the live season is a separate grant from editing seasons.
        if (is_active !== undefined) {
            await requireUser(event, NethackPermissions.Seasons.activate);
        }

        try {
            // Apply the field update first. A rejected rename must happen before
            // deactivation, or a duplicate-name 409 would leave the event with
            // no active season.
            if (Object.keys(updateFields).length > 0) {
                await event.context.drizzle
                    .update(seasons)
                    .set(updateFields)
                    .where(eq(seasons.id, id));
            }

            if (is_active === 1) {
                await setActiveSeason(event, id);
            } else if (is_active === 0 && existing.is_active === 1) {
                await setActiveSeason(event, null);
            }
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw createError({
                    statusCode: 409,
                    message: "A season with that name already exists",
                });
            }
            throw error;
        }

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
