import { NethackPermissions } from "~~/shared/permissions";
import { CreateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import {
    getActiveSeason,
    pickSeasonConfig,
    setActiveSeason,
} from "~~/server/utils/database/seasons";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.create);

        const body = await readValidatedBody(event, CreateSeasonRequest.parse);

        // A new season starts as a copy of the live event so switching to it
        // never blanks the theme, schedule, or status by accident.
        const active = await getActiveSeason(event);
        const seed: Record<string, unknown> = {};
        try {
            Object.assign(
                seed,
                pickSeasonConfig((await getHackathon(event)) as Record<string, unknown>),
            );
        } catch {
            // An unavailable configuration source must not block season creation.
        }
        if (active) seed.score_curve_preset = active.score_curve_preset;

        let created: { id: number } | undefined;
        try {
            [created] = await event.context.drizzle
                .insert(seasons)
                .values({ ...seed, ...body } as typeof seasons.$inferInsert)
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
