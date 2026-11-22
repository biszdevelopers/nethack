import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { MAX_BULK_DELETE_IDS, POSTGRES_INT_MAX } from "~~/shared/schemas";
import { seasons, teams } from "~~/server/database/schema";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { deleteTeamsInTransaction } from "~~/server/utils/database/teams";
import { lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const DeleteTeamsRequest = z.object({
    ids: z.array(z.number().int().positive().max(POSTGRES_INT_MAX)).max(MAX_BULK_DELETE_IDS),
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
                await lockForUpdateIfSupported(
                    tx
                        .select({ id: seasons.id })
                        .from(seasons)
                        .where(eq(seasons.id, season_id))
                        .limit(1),
                );
                await calculateSeasonScoresWithDatabase(tx, season_id, true);
            }

            await writeAuditEvent(tx, event, {
                action: "teams.delete",
                entity_type: "team",
                entity_id: body.ids.join(","),
                reason: "bulk team deletion",
            });
        });

        return { message: `Deleted ${body.ids.length} team(s)` };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
