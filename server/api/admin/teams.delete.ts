import { z } from "zod";
import { inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { MAX_BULK_DELETE_IDS } from "~~/shared/schemas";
import { teams } from "~~/server/database/schema";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { deleteTeamsInTransaction } from "~~/server/utils/database/teams";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const DeleteTeamsRequest = z.object({
    ids: z.array(z.number().int().positive()).max(MAX_BULK_DELETE_IDS),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Teams.delete);

        const body = await readValidatedBody(event, DeleteTeamsRequest.parse);

        // Delete and recompute in one transaction: a recompute failure must
        // not report an error after the destructive change already committed.
        await event.context.drizzle.transaction(async (tx) => {
            const affectedSeasons = await tx
                .selectDistinct({ season_id: teams.season_id })
                .from(teams)
                .where(inArray(teams.id, body.ids));

            await deleteTeamsInTransaction(tx, body.ids);

            // Deleting a submitted team leaves a gap in the published ranking.
            for (const { season_id } of affectedSeasons) {
                await calculateSeasonScoresWithDatabase(tx, season_id, true);
            }
        });

        return { message: `Deleted ${body.ids.length} team(s)` };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
