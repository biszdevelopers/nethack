import { and, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminTeamReopenRequest, TeamIdParams } from "~~/shared/schemas";
import { seasons, teamScores, teams } from "~~/server/database/schema";
import { getTeamById } from "~~/server/utils/database/teams";
import { firstRow, lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const body = await readValidatedBody(event, AdminTeamReopenRequest.parse);

        const team = await getTeamById(event, id);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });

        await event.context.drizzle.transaction(async (tx) => {
            const season = await firstRow(
                lockForUpdateIfSupported(
                    tx.select().from(seasons).where(eq(seasons.id, team.season_id)).limit(1),
                ),
            );
            if (!season) throw createError({ statusCode: 404, message: "Season not found." });
            if (season.results_published === 1 || season.results_published_at) {
                throw createError({
                    statusCode: 409,
                    message:
                        "Results are published; reopen the season before changing submissions.",
                });
            }

            const evaluation = await firstRow(
                tx
                    .select({ team_id: teamScores.team_id })
                    .from(teamScores)
                    .where(
                        and(eq(teamScores.team_id, id), eq(teamScores.season_id, team.season_id)),
                    )
                    .limit(1),
            );
            if (evaluation) {
                throw createError({
                    statusCode: 409,
                    message: "Delete the team's evaluations before reopening its submission.",
                });
            }

            await tx
                .update(teams)
                .set({ project_submitted: 0, rank: null })
                .where(eq(teams.id, id));
            await writeAuditEvent(tx, event, {
                action: "team.reopen",
                entity_type: "team",
                entity_id: id,
                before: { project_submitted: 1, submitted_at: team.submitted_at },
                after: { project_submitted: 0 },
                reason: body.reason ?? null,
            });
        });

        return { message: "Submission reopened", team_id: id };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
