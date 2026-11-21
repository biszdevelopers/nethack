import type { H3Event } from "h3";
import { PositiveIntParam } from "~~/shared/schemas";
import { toPublicSeason } from "~~/server/utils/public-season";
import { getEventState } from "~~/server/utils/event-state";

function parseSeasonId(event: H3Event): number {
    const raw = getRouterParam(event, "id");
    if (!raw || !/^\d+$/.test(raw)) {
        throw createError({ statusCode: 400, statusMessage: "Invalid season ID" });
    }
    const parsed = PositiveIntParam.safeParse(raw);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: "Invalid season ID" });
    }
    return parsed.data;
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const id = parseSeasonId(event);

        const season = await getSeasonById(event, id);

        if (!season) {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }

        const isActiveSeason = season.is_active === 1;
        const state = isActiveSeason ? await getEventState(event) : null;
        return toPublicSeason(season, {
            is_submission_closed: state ? state.submissionsClosed : true,
            is_gallery_public: state ? state.galleryPublic : true,
        });
    }),
);
