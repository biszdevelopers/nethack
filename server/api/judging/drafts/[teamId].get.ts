import { and, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import { judgingDrafts, rubricVersions, teamScores } from "~~/server/database/schema";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { getTeam } from "~~/server/utils/database/teams";
import { firstRow } from "~~/server/utils/database/query";
import { applyRateLimit, JUDGING_DRAFT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { z } from "zod";
import { resolveJudgeCommentGuidance } from "~~/shared/judge-comments";
import { resolveLiveRubricVersionId } from "~~/server/utils/database/rubrics";

const ParamsSchema = z.object({ teamId: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.assignmentsRead);
        const { teamId } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const season = await getActiveSeason(event);
        const team = await getTeam(event, teamId);

        if (!season || !team?.project_submitted) {
            throw createError({ statusCode: 404, message: "Submitted project not found" });
        }

        if (team.season_id !== season.id) {
            throw createError({ statusCode: 404, message: "Submitted project not found" });
        }

        const finalized = await firstRow(
            event.context.drizzle
                .select()
                .from(teamScores)
                .where(and(eq(teamScores.team_id, teamId), eq(teamScores.judge_user_id, judge.id)))
                .limit(1),
        );
        // Finalized scores take precedence if a draft cleanup failed after submission.
        const draft = finalized
            ? undefined
            : await firstRow(
                  event.context.drizzle
                      .select()
                      .from(judgingDrafts)
                      .where(
                          and(
                              eq(judgingDrafts.team_id, teamId),
                              eq(judgingDrafts.judge_user_id, judge.id),
                          ),
                      )
                      .limit(1),
              );

        const rubricVersionId =
            draft?.rubric_version_id ??
            finalized?.rubric_version_id ??
            (await resolveLiveRubricVersionId(event, season));
        const version = rubricVersionId
            ? await firstRow(
                  event.context.drizzle
                      .select()
                      .from(rubricVersions)
                      .where(
                          and(
                              eq(rubricVersions.id, rubricVersionId),
                              eq(rubricVersions.season_id, season.id),
                          ),
                      )
                      .limit(1),
              )
            : undefined;
        if (!version)
            throw createError({ statusCode: 409, message: "Judging rubric is unavailable" });

        return {
            rubric: {
                version_id: version.id,
                name: version.name,
                tracks: version.definition.tracks,
                commentGuidance: resolveJudgeCommentGuidance(version.definition.commentGuidance),
            },
            draft: draft
                ? {
                      scores: draft.scores,
                      reasoning: draft.reasoning,
                      rubric_version_id: draft.rubric_version_id,
                      updated_at: draft.updated_at.toISOString(),
                  }
                : null,
        };
    }, JUDGING_DRAFT_RATE_LIMIT_CONFIG),
);
