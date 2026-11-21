import { NethackPermissions } from "~~/shared/permissions";
import { CreateAwardRequest } from "~~/shared/schemas";
import { awards } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const body = await readValidatedBody(event, CreateAwardRequest.parse);

        const row = await event.context.drizzle.transaction(async (tx) => {
            const saved = await firstRow(
                tx
                    .insert(awards)
                    .values(body)
                    .onConflictDoUpdate({
                        target: awards.namespace,
                        set: {
                            name: body.name,
                            description: body.description,
                            icon: body.icon,
                            color: body.color,
                        },
                    })
                    .returning(),
            );
            await writeAuditEvent(tx, event, {
                action: "award.upsert",
                entity_type: "award",
                entity_id: body.namespace,
                after: body,
            });
            return saved;
        });

        return { award: row };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
