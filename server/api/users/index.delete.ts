import { z } from "zod";
import { inArray } from "drizzle-orm";
import { isInitialAdminEmail, NethackPermissions } from "~~/shared/permissions";
import { teamScores } from "~~/server/database/schema";
import { calculateSeasonScores } from "~~/server/utils/scoring";

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

        const affectedSeasons = await event.context.drizzle
            .selectDistinct({ season_id: teamScores.season_id })
            .from(teamScores)
            .where(inArray(teamScores.judge_user_id, body.ids));

        await deleteUsers(event, body.ids);

        // Removed evaluations must not keep contributing to published scores/ranks.
        for (const { season_id } of affectedSeasons) {
            if (season_id !== null) await calculateSeasonScores(event, season_id, true);
        }

        return { message: `Deleted ${body.ids.length} user(s)` };
    }),
);
