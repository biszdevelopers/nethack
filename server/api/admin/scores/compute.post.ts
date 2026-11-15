import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { computeScores } from "~~/server/utils/scoring";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const QuerySchema = z.object({ season_id: PositiveIntParam.optional() });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Judging.resultsCompute);

        const query = await getValidatedQuery(event, QuerySchema.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);

        if (!season) {
            throw createError({ statusCode: 404, message: "Season not found" });
        }

        await computeScores(event, season.id);
        return { message: "Scores and ranks were recomputed.", season_id: season.id };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
