import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";

const SeasonIdParams = z.object({ id: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.delete);

        const { id } = await getValidatedRouterParams(event, SeasonIdParams.parse);

        const existing = await firstRow(
            event.context.drizzle.select().from(seasons).where(eq(seasons.id, id)).limit(1),
        );

        if (!existing) {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }

        await event.context.drizzle.delete(seasons).where(eq(seasons.id, id));
        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
