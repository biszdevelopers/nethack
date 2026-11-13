import { toPublicSeason } from "~~/server/utils/public-season";

export default defineEventHandler(async (event) => {
    const seasons = await getSeasons(event);
    return seasons.map(toPublicSeason);
});
