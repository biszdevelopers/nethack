import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { judgingDrafts } from "~~/server/database/schema";
import { applyRateLimit, JUDGING_DRAFT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getEventState } from "~~/server/utils/event-state";
import { isJudgingOpen } from "~~/server/utils/judging";

const ParamsSchema = z.object({ teamId: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
        const { teamId } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const state = await getEventState(event);
        if (!isJudgingOpen(state.hackathon, state.season)) {
            throw createError({ statusCode: 409, message: "Judging is not open" });
        }
        await event.context.drizzle
            .delete(judgingDrafts)
            .where(
                and(eq(judgingDrafts.team_id, teamId), eq(judgingDrafts.judge_user_id, judge.id)),
            );
        return { deleted: true };
    }, JUDGING_DRAFT_RATE_LIMIT_CONFIG),
);
