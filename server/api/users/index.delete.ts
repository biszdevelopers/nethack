import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { MAX_BULK_DELETE_IDS, POSTGRES_INT_MAX } from "~~/shared/schemas";
import { seasons, teamScores, users } from "~~/server/database/schema";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { deleteUsersInTransaction } from "~~/server/utils/database/users";
import { lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";

const DeleteUsersRequest = z.object({
    ids: z.array(z.number().int().positive().max(POSTGRES_INT_MAX)).max(MAX_BULK_DELETE_IDS),
});

type AdminRow = { id: number; is_admin: number | boolean | null };

/** Only a stored administrator flag grants access; the email allowlist is not active. */
function isEffectiveAdmin(user: AdminRow): boolean {
    return Boolean(user.is_admin);
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const currentUser = await requireUser(event, NethackPermissions.Users.delete);

        const body = await readValidatedBody(event, DeleteUsersRequest.parse);
        const targets = await Promise.all(body.ids.map((id) => getUser(event, id)));
        if (targets.some((target) => target && target.id === currentUser.id)) {
            throw createError({
                statusCode: 403,
                message: "You cannot delete yourself",
            });
        }

        // Delete and recompute in one transaction: a recompute failure must
        // not report an error after the destructive change already committed.
        await event.context.drizzle.transaction(async (tx) => {
            // Acquire season locks before the account rows, matching the
            // season -> team/user order used by scoring and team creation.
            const affectedSeasons = await tx
                .selectDistinct({ season_id: teamScores.season_id })
                .from(teamScores)
                .where(inArray(teamScores.judge_user_id, body.ids));
            for (const { season_id } of affectedSeasons) {
                if (season_id !== null) {
                    await lockForUpdateIfSupported(
                        tx
                            .select({ id: seasons.id })
                            .from(seasons)
                            .where(eq(seasons.id, season_id))
                            .limit(1),
                    );
                }
            }

            // Lock every account so two concurrent deletions cannot both see
            // another administrator and leave the portal without one.
            const accounts: AdminRow[] = await lockForUpdateIfSupported(
                tx.select({ id: users.id, is_admin: users.is_admin }).from(users),
            );
            const deleting = new Set(body.ids);
            const removesAdministrator = accounts.some(
                (account) => deleting.has(account.id) && isEffectiveAdmin(account),
            );
            const remainingAdministrators = accounts.filter(
                (account) => !deleting.has(account.id) && isEffectiveAdmin(account),
            );
            if (removesAdministrator && remainingAdministrators.length === 0) {
                throw createError({
                    statusCode: 403,
                    message: "At least one administrator must remain",
                });
            }

            await deleteUsersInTransaction(tx, body.ids);

            // Removed evaluations must not keep contributing to published scores/ranks.
            for (const { season_id } of affectedSeasons) {
                if (season_id !== null) {
                    await calculateSeasonScoresWithDatabase(tx, season_id, true);
                }
            }

            await writeAuditEvent(tx, event, {
                action: "users.delete",
                entity_type: "user",
                entity_id: body.ids.join(","),
                reason: "bulk user deletion",
            });
        });

        return { message: `Deleted ${body.ids.length} user(s)` };
    }),
);
