import { z } from "zod";
import { inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { teams } from "~~/server/database/schema";
import { calculateSeasonScores } from "~~/server/utils/scoring";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const DeleteTeamsRequest = z.object({
    ids: z.array(z.number().int().positive()),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Teams.delete);

        const body = await readValidatedBody(event, DeleteTeamsRequest.parse);
        const affectedSeasons = await event.context.drizzle
            .selectDistinct({ season_id: teams.season_id })
            .from(teams)
            .where(inArray(teams.id, body.ids));

        await deleteTeams(event, body.ids);

        // Deleting a submitted team leaves a gap in the published ranking.
        for (const { season_id } of affectedSeasons) {
            await calculateSeasonScores(event, season_id, true);
        }

        return { message: `Deleted ${body.ids.length} team(s)` };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
