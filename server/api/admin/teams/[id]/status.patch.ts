import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminTeamStatusRequest, TeamIdParams } from "~~/shared/schemas";
import { seasons, teams } from "~~/server/database/schema";
import { getTeamById } from "~~/server/utils/database/teams";
import { getAwardsForTeams } from "~~/server/utils/database/awards";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);
        const body = await readValidatedBody(event, AdminTeamStatusRequest.parse);

        const team = await getTeamById(event, id);
        if (!team) throw createError({ statusCode: 404, message: "Team not found." });

        const ranked = await event.context.drizzle.transaction(async (tx) => {
            await lockForUpdateIfSupported(
                tx
                    .select({ id: seasons.id })
                    .from(seasons)
                    .where(eq(seasons.id, team.season_id))
                    .limit(1),
            );
            await tx
                .update(teams)
                .set({
                    status: body.status,
                    ...(body.status === "active" ? {} : { rank: null }),
                })
                .where(eq(teams.id, id));

            const standings = await calculateSeasonScoresWithDatabase(tx, team.season_id, true);
            await writeAuditEvent(tx, event, {
                action: "team.status",
                entity_type: "team",
                entity_id: id,
                before: { status: team.status },
                after: { status: body.status },
                reason: body.reason ?? null,
            });
            return standings;
        });

        const awardsByTeam = await getAwardsForTeams(
            event,
            ranked.map((row) => row.id),
        );
        const standings = ranked.map((row) => ({
            team_id: row.id,
            name: row.name,
            pathway: row.pathway,
            status: row.status,
            score_exact: row.score_exact,
            score: row.score,
            rank: row.rank,
            awards: (awardsByTeam[row.id] ?? []).map((award) => award.name),
            project_name: row.project_name,
            project_demo_url: row.project_demo_url,
            project_repo_url: row.project_repo_url,
        })) satisfies AdminStandingRow[];

        return { season_id: team.season_id, standings };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
