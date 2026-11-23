import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam, SaveJudgingDraftRequest } from "~~/shared/schemas";
import { judgingDrafts, rubricVersions, seasons, teamScores } from "~~/server/database/schema";
import { getRubricTrack, validateRubricScores } from "~~/shared/rubric";
import { getTeam } from "~~/server/utils/database/teams";
import { firstRow, lockForUpdateIfSupported } from "~~/server/utils/database/query";
import {
    getJudgeScope,
    isJudgingOpen,
    judgeCanEvaluate,
    assertJudgeNotCompeting,
} from "~~/server/utils/judging";
import { getEventState } from "~~/server/utils/event-state";
import { resolveLiveRubricVersionId } from "~~/server/utils/database/rubrics";
import { applyRateLimit, JUDGING_DRAFT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const ParamsSchema = z.object({ teamId: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
        const { teamId } = await getValidatedRouterParams(event, ParamsSchema.parse);
        if (judge.team_id === teamId) {
            throw createError({
                statusCode: 403,
                message: "You cannot score your own team",
            });
        }
        const body = await readValidatedBody(event, SaveJudgingDraftRequest.parse);
        const state = await getEventState(event);
        const season = state.season;

        if (!season || !isJudgingOpen(state.hackathon, season)) {
            throw createError({ statusCode: 409, message: "Judging is not open" });
        }
        await assertJudgeNotCompeting(event, judge, season.id);

        const team = await getTeam(event, teamId);
        if (!team?.project_submitted || team.season_id !== season.id) {
            throw createError({ statusCode: 404, message: "Submitted project not found" });
        }
        if (team.status !== "active") {
            throw createError({ statusCode: 409, message: "This project is no longer competing" });
        }
        const scope = await getJudgeScope(event.context.drizzle, season.id, judge.id);
        if (!judgeCanEvaluate(scope, team)) {
            throw createError({
                statusCode: 403,
                message: "This project is outside your judging assignment",
            });
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
        if (!currentDraft && (await resolveLiveRubricVersionId(event, season)) !== version.id) {
            throw createError({
                statusCode: 409,
                message: "The rubric changed. Reload the project before saving a draft.",
            });
        }
        const track = getRubricTrack(version.definition, team.pathway);
        if (!track)
            throw createError({ statusCode: 409, message: "No rubric track matches this project" });
        const issues = validateRubricScores(track, body.scores, { allowPartial: true });
        if (issues.length > 0) {
            throw createError({ statusCode: 400, message: issues[0] });
        }

        const saved = await event.context.drizzle.transaction(async (tx) => {
            // Serialize with score finalization: it locks the season first and
            // then deletes the draft, so this upsert cannot resurrect one.
            await lockForUpdateIfSupported(
                tx
                    .select({ id: seasons.id })
                    .from(seasons)
                    .where(eq(seasons.id, season.id))
                    .limit(1),
            );
            const committed = await firstRow(
                tx
                    .select({ team_id: teamScores.team_id })
                    .from(teamScores)
                    .where(
                        and(eq(teamScores.team_id, teamId), eq(teamScores.judge_user_id, judge.id)),
                    )
                    .limit(1),
            );
            if (committed) {
                throw createError({
                    statusCode: 409,
                    message: "This evaluation is finalized and can no longer be changed.",
                });
            }
            return firstRow(
                tx
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
        });

        return {
            saved: true,
            rubric_version_id: version.id,
            updated_at: saved?.updated_at.toISOString(),
        };
    }, JUDGING_DRAFT_RATE_LIMIT_CONFIG),
);
