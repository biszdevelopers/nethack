import { NethackPermissions } from "~~/shared/permissions";
import { UpdateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";

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

        const { id, ...updateFields } = body;
        await event.context.drizzle.update(seasons).set(updateFields).where(eq(seasons.id, id));

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
