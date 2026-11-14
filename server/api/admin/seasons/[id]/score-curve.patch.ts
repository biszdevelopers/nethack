import { eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { isScoreCurvePreset } from "~~/shared/score-curve";
import { seasons } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const BodySchema = z.object({ preset: z.string().refine(isScoreCurvePreset) });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);
        const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const { preset } = await readValidatedBody(event, BodySchema.parse);
        const updated = await firstRow(
            event.context.drizzle
                .update(seasons)
                .set({ score_curve_preset: preset })
                .where(eq(seasons.id, id))
                .returning(),
        );
        if (!updated) throw createError({ statusCode: 404, message: "Season not found." });
        return { season_id: updated.id, preset: updated.score_curve_preset };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
