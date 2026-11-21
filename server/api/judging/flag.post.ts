import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgeFlagRequest } from "~~/shared/schemas";
import { teams } from "~~/server/database/schema";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { upsertJudgeFlag } from "~~/server/utils/database/judge-flags";
import { firstRow } from "~~/server/utils/database/query";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.assignmentsRead);
        const body = await readValidatedBody(event, JudgeFlagRequest.parse);

        const season = await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "No active season" });

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
        if (judge.team_id === team.id) {
            throw createError({
                statusCode: 409,
                message: "Judges cannot flag their own team",
            });
        }

        await upsertJudgeFlag(event, {
            seasonId: season.id,
            teamId: team.id,
            judgeUserId: judge.id,
            reason: body.reason,
        });

        return { message: "Flag reported to the organizers" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
