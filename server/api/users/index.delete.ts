import { z } from "zod";
import { isInitialAdminEmail, NethackPermissions } from "~~/shared/permissions";

const DeleteUsersRequest = z.object({
    ids: z.array(z.number().int().positive()),
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

        await deleteUsers(event, body.ids);

        return { message: `Deleted ${body.ids.length} user(s)` };
    }),
);
