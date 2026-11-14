import { NethackPermissions } from "~~/shared/permissions";
import { CreateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.create);

        const body = await readValidatedBody(event, CreateSeasonRequest.parse);

        await event.context.drizzle.insert(seasons).values(body);
        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
