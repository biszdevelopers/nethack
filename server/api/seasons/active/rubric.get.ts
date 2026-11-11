import { getActiveSeason } from "~~/server/utils/database/seasons";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";

/** Public criteria help participants choose the right track before submission. */
export default defineEventHandler(async (event) => {
    const season = await getActiveSeason(event);
    if (!season) {
        throw createError({ statusCode: 404, message: "No active season is available." });
    }

    const version = await getRubricVersionForSeason(event, season.id);
    if (!version) {
        throw createError({
            statusCode: 409,
            message: "The active season does not have a rubric.",
        });
    }

    return {
        version_id: version.id,
        tracks: version.definition.tracks,
    };
});
