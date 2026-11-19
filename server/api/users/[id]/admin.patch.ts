import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "~~/server/database/schema";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { UserIdParams } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";

const SetAdminRequest = z.object({
    is_admin: z.boolean(),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const currentUser = await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, UserIdParams.parse);
        const body = await readValidatedBody(event, SetAdminRequest.parse);

        const target = await getUser(event, id);
        if (!target) {
            throw createError({ statusCode: 404, message: "User not found" });
        }
        if (isInitialAdminEmail(target.email) && !body.is_admin) {
            throw createError({
                statusCode: 403,
                message: "Initial administrators cannot be demoted",
            });
        }
        if (target.id === currentUser.id && !body.is_admin) {
            throw createError({
                statusCode: 403,
                message: "You cannot remove your own administrator access",
            });
        }

        const [updated] = await event.context.drizzle
            .update(users)
            .set({ is_admin: body.is_admin ? 1 : 0 })
            .where(eq(users.id, id))
            .returning({ id: users.id, is_admin: users.is_admin });
        if (!updated) {
            throw createError({ statusCode: 404, message: "User not found" });
        }

        return {
            id: updated.id,
            is_admin: Boolean(updated.is_admin || isInitialAdminEmail(target.email)),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
