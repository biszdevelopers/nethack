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
        const copyLiveSettings = body.copy_live_settings !== false;
        const isActive = body.is_active ?? 0;

        if (isActive === 1 && !copyLiveSettings) {
            throw createError({
                statusCode: 409,
                message: "A blank-start season must be configured and approved before activation.",
            });
        }

        if (isActive === 1) {
            await requireUser(event, NethackPermissions.Seasons.activate);
        }

        const seed: Record<string, unknown> = {};
        if (copyLiveSettings) {
            // Preserve the existing behavior unless the caller explicitly
            // requests a blank season shell.
            const active = await getActiveSeason(event);
            try {
                Object.assign(
                    seed,
                    pickSeasonConfig((await getHackathon(event)) as Record<string, unknown>),
                );
            } catch {
                // An unavailable configuration source must not block season creation.
            }
            if (active) seed.score_curve_preset = active.score_curve_preset;
        }
        const seasonInput = {
            name: body.name,
            // A new row cannot be inserted as active while the current season
            // is protected by the one-active-season database constraint.
            // Activate it only after insertion through the transactional switch.
            is_active: 0,
            is_blank_start: copyLiveSettings ? 0 : 1,
        };

        let created: { id: number } | undefined;
        try {
            [created] = await event.context.drizzle
                .insert(seasons)
                .values({ ...seed, ...seasonInput } as typeof seasons.$inferInsert)
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

        if (isActive === 1 && created) {
            await setActiveSeason(event, created.id);
        }

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
