import { z } from "zod";
import { inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";
import { MAX_BULK_DELETE_IDS } from "~~/shared/schemas";
import { teamScores } from "~~/server/database/schema";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { deleteUsersInTransaction } from "~~/server/utils/database/users";

const DeleteUsersRequest = z.object({
    ids: z.array(z.number().int().positive()).max(MAX_BULK_DELETE_IDS),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const currentUser = await requireUser(event, NethackPermissions.Users.delete);

        const body = await readValidatedBody(event, DeleteUsersRequest.parse);
        const targets = await Promise.all(body.ids.map((id) => getUser(event, id)));
        if (
            targets.some(
                (target) =>
                    target && (target.id === currentUser.id || isInitialAdminEmail(target.email)),
            )
        ) {
            throw createError({
                statusCode: 403,
                message: "You cannot delete yourself or a designated initial administrator",
            });
        }

        // Delete and recompute in one transaction: a recompute failure must
        // not report an error after the destructive change already committed.
        await event.context.drizzle.transaction(async (tx) => {
            const affectedSeasons = await tx
                .selectDistinct({ season_id: teamScores.season_id })
                .from(teamScores)
                .where(inArray(teamScores.judge_user_id, body.ids));

            await deleteUsersInTransaction(tx, body.ids);

            // Removed evaluations must not keep contributing to published scores/ranks.
            for (const { season_id } of affectedSeasons) {
                if (season_id !== null) {
                    await calculateSeasonScoresWithDatabase(tx, season_id, true);
                }
            }
        });

        return { message: `Deleted ${body.ids.length} user(s)` };
    }),
);
