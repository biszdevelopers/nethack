import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { isScoreCurvePreset } from "~~/shared/score-curve";
import { PositiveIntParam } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const ParamsSchema = z.object({ id: PositiveIntParam });
const BodySchema = z.object({ preset: z.string().refine(isScoreCurvePreset) });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);
        const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const { preset } = await readValidatedBody(event, BodySchema.parse);
        const existing = await firstRow(
            event.context.drizzle.select().from(seasons).where(eq(seasons.id, id)).limit(1),
        );
        if (!existing) throw createError({ statusCode: 404, message: "Season not found." });
        if (existing.results_published === 1) {
            throw createError({
                statusCode: 409,
                message: "The score curve cannot change after results are published.",
            });
        }

        // Conditional update closes the publication race: a publish that
        // commits between the read above and this write matches zero rows.
        const write = async (tx: typeof event.context.drizzle) => {
            const row = await firstRow(
                tx
                    .update(seasons)
                    .set({ score_curve_preset: preset })
                    .where(and(eq(seasons.id, id), eq(seasons.results_published, 0)))
                    .returning(),
            );
            if (!row) {
                const stillExists = await firstRow(
                    tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, id)).limit(1),
                );
                return stillExists ? null : undefined;
            }
            await writeAuditEvent(tx, event, {
                action: "season.score_curve",
                entity_type: "season",
                entity_id: id,
                before: { score_curve_preset: existing.score_curve_preset },
                after: { score_curve_preset: preset },
            });
            return row;
        };
        const updated =
            typeof event.context.drizzle.transaction === "function"
                ? await event.context.drizzle.transaction(write)
                : await write(event.context.drizzle);
        if (updated === undefined) {
            throw createError({ statusCode: 404, message: "Season not found." });
        }
        if (!updated) {
            throw createError({
                statusCode: 409,
                message: "The score curve cannot change after results are published.",
            });
        }
        return { season_id: updated.id, preset: updated.score_curve_preset };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
