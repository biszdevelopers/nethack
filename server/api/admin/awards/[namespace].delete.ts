import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AwardNamespaceParams } from "~~/shared/schemas";
import { awards } from "~~/server/database/schema";
import { databaseErrorCodes, firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { namespace } = await getValidatedRouterParams(event, AwardNamespaceParams.parse);

        await event.context.drizzle.transaction(async (tx) => {
            let deleted: { namespace: string } | undefined;
            try {
                deleted = await firstRow(
                    tx
                        .delete(awards)
                        .where(eq(awards.namespace, namespace))
                        .returning({ namespace: awards.namespace }),
                );
            } catch (error) {
                if (databaseErrorCodes(error).includes("23503")) {
                    throw createError({
                        statusCode: 409,
                        message: "Award is still assigned to a team",
                    });
                }
                throw error;
            }
            if (!deleted) throw createError({ statusCode: 404, message: "Award not found" });
            await writeAuditEvent(tx, event, {
                action: "award.delete",
                entity_type: "award",
                entity_id: namespace,
                before: deleted,
            });
        });

        return { message: "Award deleted" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
