import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam, SaveJudgingDraftRequest } from "~~/shared/schemas";
import { judgingDrafts, rubricVersions, teamScores } from "~~/server/database/schema";
import { validateRubricScores } from "~~/shared/rubric";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { getTeam } from "~~/server/utils/database/teams";
import { firstRow } from "~~/server/utils/database/query";
import { isJudgingOpen } from "~~/server/utils/judging";
import { applyRateLimit, JUDGING_DRAFT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const ParamsSchema = z.object({ teamId: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
        const { teamId } = await getValidatedRouterParams(event, ParamsSchema.parse);
        const body = await readValidatedBody(event, SaveJudgingDraftRequest.parse);
        const [season, eventState] = await Promise.all([
            getActiveSeason(event),
            getHackathon(event),
        ]);

        if (!season || !isJudgingOpen(eventState)) {
            throw createError({ statusCode: 409, message: "Judging is not open" });
        }

        const team = await getTeam(event, teamId);
        if (!team?.project_submitted || team.season_id !== season.id) {
            throw createError({ statusCode: 404, message: "Submitted project not found" });
        }

        const finalized = await firstRow(
            event.context.drizzle
                .select({ team_id: teamScores.team_id })
                .from(teamScores)
                .where(and(eq(teamScores.team_id, teamId), eq(teamScores.judge_user_id, judge.id)))
                .limit(1),
        );
        if (finalized) {
            throw createError({
                statusCode: 409,
                message: "This evaluation is finalized and can no longer be changed.",
            });
        }

        const version = body.rubric_version_id
            ? await firstRow(
                  event.context.drizzle
                      .select()
                      .from(rubricVersions)
                      .where(
                          and(
                              eq(rubricVersions.id, body.rubric_version_id),
                              eq(rubricVersions.season_id, season.id),
                          ),
                      )
                      .limit(1),
              )
            : undefined;
        if (!version)
            throw createError({ statusCode: 409, message: "Judging rubric is unavailable" });
        const currentDraft = await firstRow(
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
        if (currentDraft && currentDraft.rubric_version_id !== version.id) {
            throw createError({
                statusCode: 409,
                message: "This draft is pinned to another rubric.",
            });
        }
        if (!currentDraft && season.rubric_version_id !== version.id) {
            throw createError({
                statusCode: 409,
                message: "The rubric changed. Reload the project before saving a draft.",
            });
        }
        const track = version.definition.tracks[team.pathway ?? ""];
        if (!track)
            throw createError({ statusCode: 409, message: "No rubric track matches this project" });
        const issues = validateRubricScores(track, body.scores, { allowPartial: true });
        if (issues.length > 0) {
            throw createError({ statusCode: 400, message: issues[0] });
        }

        const saved = await firstRow(
            event.context.drizzle
                .insert(judgingDrafts)
                .values({
                    team_id: teamId,
                    judge_user_id: judge.id,
                    rubric_version_id: version.id,
                    scores: body.scores,
                    reasoning: body.reasoning,
                    updated_at: new Date(),
                })
                .onConflictDoUpdate({
                    target: [judgingDrafts.team_id, judgingDrafts.judge_user_id],
                    set: {
                        rubric_version_id: version.id,
                        scores: body.scores,
                        reasoning: body.reasoning,
                        updated_at: new Date(),
                    },
                })
                .returning(),
        );

        return {
            saved: true,
            rubric_version_id: version.id,
            updated_at: saved?.updated_at.toISOString(),
        };
    }, JUDGING_DRAFT_RATE_LIMIT_CONFIG),
);
