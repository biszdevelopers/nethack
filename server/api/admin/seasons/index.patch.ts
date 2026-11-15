import { NethackPermissions } from "~~/shared/permissions";
import { UpdateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";
import { setActiveSeason } from "~~/server/utils/database/seasons";

function isUniqueViolation(error: unknown) {
    const code = (error as { code?: string }).code;
    return code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

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

        try {
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
