import { and, eq } from "drizzle-orm";
import z from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam, UpdateSeasonApprovalRequest } from "~~/shared/schemas";
import { seasons } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";

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
        const write = async (tx: typeof event.context.drizzle) => {
            const row = await firstRow(
                tx
                    .update(seasons)
                    .set(approval)
                    // A revoke must not race an activation and clear approval
                    // on the season that just became live.
                    .where(
                        approved
                            ? eq(seasons.id, id)
                            : and(eq(seasons.id, id), eq(seasons.is_active, 0)),
                    )
                    .returning({
                        id: seasons.id,
                        board_approved_at: seasons.board_approved_at,
                        board_approved_by: seasons.board_approved_by,
                    }),
            );
            if (!row) {
                const stillExists = await firstRow(
                    tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, id)).limit(1),
                );
                return stillExists ? null : undefined;
            }
            await writeAuditEvent(tx, event, {
                action: approved ? "season.approve" : "season.approval_revoke",
                entity_type: "season",
                entity_id: id,
                before: {
                    board_approved_at: season.board_approved_at,
                    board_approved_by: season.board_approved_by,
                },
                after: approval,
            });
            return row;
        };
        const updated =
            typeof event.context.drizzle.transaction === "function"
                ? await event.context.drizzle.transaction(write)
                : await write(event.context.drizzle);

        if (updated === undefined) {
            throw createError({ statusCode: 404, message: "Season not found" });
        }
        if (!updated) {
            throw createError({
                statusCode: 409,
                message: "An active season cannot have its board approval revoked.",
            });
        }
        const response: BoardApprovalResponse = updated;
        return response;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
