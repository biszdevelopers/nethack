import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { CreateTeamAwardRequest, TeamIdParams } from "~~/shared/schemas";
import { awards, teamAwards } from "~~/server/database/schema";
import { getTeamById } from "~~/server/utils/database/teams";
import { changedRows, firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const body = await readValidatedBody(event, CreateTeamAwardRequest.parse);

        const team = await getTeamById(event, id);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });
        const award = await firstRow(
            event.context.drizzle
                .select({ namespace: awards.namespace })
                .from(awards)
                .where(eq(awards.namespace, body.award))
                .limit(1),
        );
        if (!award) throw createError({ statusCode: 404, message: "Award not found." });

        await event.context.drizzle.transaction(async (tx) => {
            const inserted = await changedRows(
                tx
                    .insert(teamAwards)
                    .values({
                        team_id: id,
                        award: body.award,
                        meta: JSON.stringify(body.meta ?? {}),
                    })
                    .onConflictDoNothing()
                    .returning({ team_id: teamAwards.team_id }),
            );
            if (inserted === 0) {
                throw createError({ statusCode: 409, message: "Team already has this award." });
            }
            await writeAuditEvent(tx, event, {
                action: "team.award.add",
                entity_type: "team",
                entity_id: id,
                after: { award: body.award, meta: body.meta ?? {} },
            });
        });

        return { message: "Award assigned" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
