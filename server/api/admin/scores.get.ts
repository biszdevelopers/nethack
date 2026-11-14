import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { getAwardsForTeams } from "~~/server/utils/database/awards";
import { calculateSeasonScores } from "~~/server/utils/scoring";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { z } from "zod";

const QuerySchema = z.object({ season_id: PositiveIntParam.optional() });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);

        const query = await getValidatedQuery(event, QuerySchema.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);

        if (!season) {
            throw createError({ statusCode: 404, message: "Season not found" });
        }

        const rankedTeams = await calculateSeasonScores(event, season.id);
        const awardsByTeam = await getAwardsForTeams(
            event,
            rankedTeams.map((team) => team.id),
        );

        return rankedTeams.map((team) =>
            convertTeamToPublic(
                team,
                { withScore: true, withRank: true },
                awardsByTeam[team.id] ?? [],
            ),
        );
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
