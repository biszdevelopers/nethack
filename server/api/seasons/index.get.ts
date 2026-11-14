import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { toPublicSeason } from "~~/server/utils/public-season";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const seasons = await getSeasons(event);
        return seasons.map(toPublicSeason);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
