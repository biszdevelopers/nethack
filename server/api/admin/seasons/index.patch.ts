import { NethackPermissions } from "~~/shared/permissions";
import { UpdateSeasonRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import {
    firstRow,
    invalidateRequestCaches,
    isUniqueViolation,
} from "~~/server/utils/database/query";
import { setActiveSeason } from "~~/server/utils/database/seasons";
import { writeAuditEvent } from "~~/server/utils/audit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);

        const body = await readValidatedBody(event, UpdateSeasonRequest.parse);

        const existing = await firstRow(
            event.context.drizzle.select().from(seasons).where(eq(seasons.id, body.id)).limit(1),
        );

        if (!existing) {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }

        const { id, is_active, ...updateFields } = body;
        if (is_active === undefined && Object.keys(updateFields).length === 0) {
            throw createError({
                statusCode: 400,
                message: "No fields to update",
            });
        }

        // Switching the live season is a separate grant from editing seasons.
        if (is_active !== undefined) {
            await requireUser(event, NethackPermissions.Seasons.activate);
        }

        // Validate a rename before deactivating the live season; otherwise a
        // duplicate-name 409 leaves the event with no active season. The
        // activation snapshot must still run before the field update, or it
        // would overwrite theme/schedule edits made in the same request.
        if (updateFields.name !== undefined) {
            const seasonsList = await getSeasons(event);
            const duplicate = seasonsList.some(
                (season) =>
                    season.id !== id &&
                    season.name.trim().toLowerCase() === updateFields.name!.trim().toLowerCase(),
            );
            if (duplicate) {
                throw createError({
                    statusCode: 409,
                    message: "A season with that name already exists",
                });
            }
        }

        try {
            if (is_active === 1) {
                await setActiveSeason(event, id);
            } else if (is_active === 0 && existing.is_active === 1) {
                await setActiveSeason(event, null);
            }

            if (Object.keys(updateFields).length > 0) {
                const write = async (tx: typeof event.context.drizzle) => {
                    await tx.update(seasons).set(updateFields).where(eq(seasons.id, id));
                    await writeAuditEvent(tx, event, {
                        action: "season.update",
                        entity_type: "season",
                        entity_id: id,
                        before: {
                            name: existing.name,
                            max_team_members: existing.max_team_members,
                        },
                        after: updateFields,
                    });
                };
                if (typeof event.context.drizzle.transaction === "function") {
                    await event.context.drizzle.transaction(write);
                } else {
                    await write(event.context.drizzle);
                }
            }
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw createError({
                    statusCode: 409,
                    message: "A season with that name already exists",
                });
            }
            throw error;
        }

        invalidateRequestCaches(event);
        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
