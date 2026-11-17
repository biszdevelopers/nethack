import { eq } from "drizzle-orm";
import z from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam, UpdateSeasonApprovalRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";

const ParamsSchema = z.object({ id: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Seasons.update);
        const { id } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const { approved } = await readValidatedBody(event, UpdateSeasonApprovalRequest.parse);
        const season = await firstRow(
            event.context.drizzle.select().from(seasons).where(eq(seasons.id, id)).limit(1),
        );

        if (!season) throw createError({ statusCode: 404, message: "Season not found" });
        if (season.is_blank_start !== 1) {
            throw createError({
                statusCode: 409,
                message: "Board approval is only tracked for a blank-start season.",
            });
        }
        if (!approved && season.is_active === 1) {
            throw createError({
                statusCode: 409,
                message: "An active season cannot have its board approval revoked.",
            });
        }

        const approval = approved
            ? { board_approved_at: new Date(), board_approved_by: user.id }
            : { board_approved_at: null, board_approved_by: null };
        const [updated] = await event.context.drizzle
            .update(seasons)
            .set(approval)
            .where(eq(seasons.id, id))
            .returning({
                id: seasons.id,
                board_approved_at: seasons.board_approved_at,
                board_approved_by: seasons.board_approved_by,
            });

        if (!updated) throw createError({ statusCode: 404, message: "Season not found" });
        const response: BoardApprovalResponse = updated;
        return response;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
