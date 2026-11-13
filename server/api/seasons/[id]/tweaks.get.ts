import { toPublicSeason } from "~~/server/utils/public-season";

export default defineEventHandler(async (event) => {
    const rawId = getRouterParam(event, "id");
    if (!rawId || !/^\d+$/.test(rawId)) {
        throw createError({ statusCode: 400, message: "Invalid season ID" });
    }

    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw createError({ statusCode: 400, message: "Invalid season ID" });
    }

    const season = await getSeasonById(event, id);

    if (!season) {
        throw createError({
            statusCode: 404,
            message: "Season not found",
        });
    }

    return toPublicSeason(season);
});
