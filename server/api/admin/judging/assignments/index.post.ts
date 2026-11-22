import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgeAssignmentRequest } from "~~/shared/schemas";
import { judgeAssignments, teams, users } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { firstRow } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const body = await readValidatedBody(event, JudgeAssignmentRequest.parse);
        const season = body.season_id
            ? await getSeasonById(event, body.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const judge = await firstRow(
            event.context.drizzle
                .select({ id: users.id, is_admin: users.is_admin, is_judge: users.is_judge })
                .from(users)
                .where(eq(users.id, body.judge_user_id))
                .limit(1),
        );
        if (!judge) throw createError({ statusCode: 404, message: "Judge not found" });

        if (body.team_id !== undefined && body.team_id !== null) {
            const team = await firstRow(
                event.context.drizzle
                    .select({ id: teams.id, season_id: teams.season_id })
                    .from(teams)
                    .where(eq(teams.id, body.team_id))
                    .limit(1),
            );
            if (!team || team.season_id !== season.id) {
                throw createError({ statusCode: 404, message: "Team not found in this season" });
            }
        }

        const assignment = await event.context.drizzle.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(judgeAssignments)
                .values({
                    season_id: season.id,
                    judge_user_id: body.judge_user_id,
                    pathway: body.pathway ?? null,
                    team_id: body.team_id ?? null,
                    created_at: new Date(),
                })
                .onConflictDoNothing()
                .returning();
            if (!inserted) {
                throw createError({ statusCode: 409, message: "Assignment already exists" });
            }
            // Assigning a participant is the promotion step. It grants the
            // judging permissions on the next session refresh; administrators
            // already receive every permission and need no local flag.
            if (!judge.is_admin && !judge.is_judge) {
                await tx.update(users).set({ is_judge: 1 }).where(eq(users.id, judge.id));
            }
            await writeAuditEvent(tx, event, {
                action: "judging.assignment.create",
                entity_type: "season",
                entity_id: season.id,
                after: {
                    judge_user_id: body.judge_user_id,
                    pathway: body.pathway ?? null,
                    team_id: body.team_id ?? null,
                },
            });
            return inserted;
        });

        return { assignment };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
