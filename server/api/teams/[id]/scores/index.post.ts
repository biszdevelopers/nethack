import { NethackPermissions } from "~~/shared/permissions";
import { SubmitTeamScoresRequest, TeamIdParams } from "~~/shared/schemas";
import { validateRubricScores } from "~~/shared/rubric";
import { getTeam } from "~~/server/utils/database/teams";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { rubricVersions } from "~~/server/database/schema";
import { and, eq } from "drizzle-orm";
import { firstRow } from "~~/server/utils/database/query";
import { applyRateLimit, VOTE_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { isJudgingOpen } from "~~/server/utils/judging";
import { resolveLiveRubricVersionId } from "~~/server/utils/database/rubrics";
import {
    commentContainsJudgeIdentity,
    JUDGE_COMMENT_IDENTITY_ERROR,
} from "~~/shared/judge-comments";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const judge = await requireUser(event, NethackPermissions.Judging.scoresWriteAssigned);
        const userID = judge.id;

        const [hackathon, season] = await Promise.all([
            getHackathon(event),
            getActiveSeason(event),
        ]);
        if (!isJudgingOpen(hackathon) || !season) {
            throw createError({
                status: 409,
                message: "Scoring is not open",
            });
        }

        const team = await getTeam(event, teamID);
        if (!team) {
            throw createError({
                status: 404,
                message: "Team not found",
            });
        }
        if (team.season_id !== season.id) {
            throw createError({ status: 404, message: "Team not found" });
        }
        if (!team.project_submitted) {
            throw createError({
                status: 400,
                message: "Team has not submitted a project",
            });
        }

        const payload = await readValidatedBody(event, SubmitTeamScoresRequest.parse);
        if (commentContainsJudgeIdentity(payload.reasoning, judge.email, judge.name)) {
            throw createError({ statusCode: 400, message: JUDGE_COMMENT_IDENTITY_ERROR });
        }
        const version = await firstRow(
            event.context.drizzle
                .select()
                .from(rubricVersions)
                .where(
                    and(
                        eq(rubricVersions.id, payload.rubric_version_id),
                        eq(rubricVersions.season_id, season.id),
                    ),
                )
                .limit(1),
        );
        if (!version) {
            throw createError({ status: 409, message: "The active season has no judging rubric." });
        }
        const track = version.definition.tracks[team.pathway ?? ""];
        if (!track) {
            throw createError({ status: 409, message: "No rubric track matches this project." });
        }
        const issues = validateRubricScores(track, payload.scores);
        if (issues.length > 0) {
            throw createError({ status: 400, message: issues[0] });
        }

        try {
            await resolveLiveRubricVersionId(event, season);
            await createTeamScores(event, {
                team_id: teamID,
                season_id: season.id,
                judge_user_id: userID,
                scores: JSON.stringify(payload.scores),
                reasoning: payload.reasoning,
                rubric_version_id: payload.rubric_version_id,
            });
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "23505" && code !== "SQLITE_CONSTRAINT_PRIMARYKEY" && code !== "1555") {
                throw error;
            }
            throw createError({
                status: 409,
                message: "You already scored this project",
            });
        }

        return { message: "Successfully scored project" };
    }, VOTE_RATE_LIMIT_CONFIG),
);
