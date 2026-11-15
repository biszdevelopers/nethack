import { NethackPermissions } from "~~/shared/permissions";
import { CreateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { setActiveSeason } from "~~/server/utils/database/seasons";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.create);

        const body = await readValidatedBody(event, CreateSeasonRequest.parse);

        let created: { id: number } | undefined;
        try {
            [created] = await event.context.drizzle
                .insert(seasons)
                .values(body)
                .returning({ id: seasons.id });
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
                throw createError({
                    statusCode: 409,
                    message: "A season with that name already exists",
                });
            }
            throw error;
        }

        if (body.is_active === 1 && created) {
            await setActiveSeason(event, created.id);
        }

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
