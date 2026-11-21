import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "~~/server/database/schema";
import { lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { UserIdParams } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

const SetAdminRequest = z.object({
    is_admin: z.boolean(),
});

type AdminRow = { id: number; is_admin: number | boolean | null };

/** Only a stored administrator flag grants access; the email allowlist is not active. */
function isEffectiveAdmin(user: AdminRow): boolean {
    return Boolean(user.is_admin);
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const currentUser = await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, UserIdParams.parse);
        const body = await readValidatedBody(event, SetAdminRequest.parse);

        const updated = await event.context.drizzle.transaction(async (tx) => {
            // Lock every account so two concurrent demotions cannot both see
            // another administrator and leave the portal without one.
            const accounts: AdminRow[] = await lockForUpdateIfSupported(
                tx.select({ id: users.id, is_admin: users.is_admin }).from(users),
            );
            const target = accounts.find((account) => account.id === id);
            if (!target) {
                throw createError({ statusCode: 404, message: "User not found" });
            }
            if (target.id === currentUser.id && !body.is_admin) {
                throw createError({
                    statusCode: 403,
                    message: "You cannot remove your own administrator access",
                });
            }
            if (!body.is_admin && isEffectiveAdmin(target)) {
                const remaining = accounts.filter(
                    (account) => account.id !== target.id && isEffectiveAdmin(account),
                );
                if (remaining.length === 0) {
                    throw createError({
                        statusCode: 403,
                        message: "At least one administrator must remain",
                    });
                }
            }

            const [row] = await tx
                .update(users)
                .set({ is_admin: body.is_admin ? 1 : 0 })
                .where(eq(users.id, id))
                .returning({ id: users.id, is_admin: users.is_admin });
            if (!row) {
                throw createError({ statusCode: 404, message: "User not found" });
            }
            return row;
        });

        return {
            id: updated.id,
            is_admin: Boolean(updated.is_admin),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
