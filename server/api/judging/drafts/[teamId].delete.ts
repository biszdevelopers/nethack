import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { judgingDrafts } from "~~/server/database/schema";

const ParamsSchema = z.object({ teamId: PositiveIntParam });

export default defineEventHandler(async (event) => {
    const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
    const { teamId } = await getValidatedRouterParams(event, ParamsSchema.parse);
    await event.context.drizzle
        .delete(judgingDrafts)
        .where(and(eq(judgingDrafts.team_id, teamId), eq(judgingDrafts.judge_user_id, judge.id)));
    return { deleted: true };
});
