import type { H3Event } from "h3";
import { and, count, eq, inArray } from "drizzle-orm";
import {
    judgingDrafts,
    rubricVersions,
    seasons,
    teamScores,
    teams,
    users,
} from "~~/server/database/schema";
import { recalculateTeamScoreAfterSubmission } from "~~/server/utils/scoring";
import { getRubricTrack, validateRubricScores } from "~~/shared/rubric";
import { firstRow, lockForUpdateIfSupported } from "./query";

type NewTeamScore = Pick<
    TeamScores,
    "team_id" | "judge_user_id" | "scores" | "reasoning" | "rubric_version_id"
> & { season_id: number };

export async function createTeamScores(event: H3Event, scores: NewTeamScore): Promise<TeamScores> {
    return event.context.drizzle.transaction(async (tx) => {
        const seasonQuery = lockForUpdateIfSupported(
            tx.select().from(seasons).where(eq(seasons.id, scores.season_id)).limit(1),
        );
        const [season] = await seasonQuery;
        // The `judging_open` portal toggle is authoritative and is enforced by
        // the calling endpoint via isJudgingOpen(). Published results no longer
        // silently veto scoring, so the toggle always dictates the state.
        if (!season || season.is_active !== 1) {
            throw createError({ statusCode: 409, message: "Judging is not open for this season." });
        }

        // Re-check the competing status inside the transaction. The route's
        // checks can go stale when an administrator disqualifies the team or
        // the judge joins a team between the pre-check and this lock.
        const [team] = await tx
            .select()
            .from(teams)
            .where(and(eq(teams.id, scores.team_id), eq(teams.status, "active")))
            .limit(1);
        if (!team || team.season_id !== season.id || !team.project_submitted) {
            throw createError({ statusCode: 404, message: "Submitted project not found." });
        }

        const [judge] = await tx
            .select({ is_admin: users.is_admin, team_id: users.team_id })
            .from(users)
            .where(eq(users.id, scores.judge_user_id))
            .limit(1);
        if (!judge) {
            throw createError({ statusCode: 403, message: "Judge account not found." });
        }
        if (judge.is_admin !== 1 && judge.team_id) {
            const competing = await firstRow(
                tx
                    .select({ id: teams.id })
                    .from(teams)
                    .where(and(eq(teams.id, judge.team_id), eq(teams.season_id, season.id)))
                    .limit(1),
            );
            if (competing) {
                throw createError({
                    statusCode: 403,
                    message: "Competing participants cannot judge this season",
                });
            }
        }

        const [version] = await tx
            .select()
            .from(rubricVersions)
            .where(
                and(
                    eq(rubricVersions.id, scores.rubric_version_id),
                    eq(rubricVersions.season_id, season.id),
                ),
            )
            .limit(1);
        if (!version) {
            throw createError({ statusCode: 409, message: "The selected rubric is unavailable." });
        }

        const track = getRubricTrack(version.definition, team.pathway);
        if (!track) {
            throw createError({
                statusCode: 409,
                message: "No rubric track matches this project.",
            });
        }
        let scoreValues: unknown;
        try {
            scoreValues = JSON.parse(scores.scores);
        } catch {
            throw createError({ statusCode: 400, message: "Scores must be valid JSON." });
        }
        if (!scoreValues || typeof scoreValues !== "object" || Array.isArray(scoreValues)) {
            throw createError({ statusCode: 400, message: "Scores must be an object." });
        }
        const scoreIssues = validateRubricScores(track, scoreValues as Record<string, number>);
        if (scoreIssues.length > 0) {
            throw createError({ statusCode: 400, message: scoreIssues[0] });
        }

        const [draft] = await tx
            .select()
            .from(judgingDrafts)
            .where(
                and(
                    eq(judgingDrafts.team_id, scores.team_id),
                    eq(judgingDrafts.judge_user_id, scores.judge_user_id),
                ),
            )
            .limit(1);
        if (draft && draft.rubric_version_id !== version.id) {
            throw createError({
                statusCode: 409,
                message: "Your saved draft uses a different rubric. Reload it before submitting.",
            });
        }
        if (!draft && season.rubric_version_id !== version.id) {
            throw createError({
                statusCode: 409,
                message: "The rubric changed. Reload the project before scoring.",
            });
        }

        const [priorScore] = await tx
            .select()
            .from(teamScores)
            .where(
                and(
                    eq(teamScores.team_id, scores.team_id),
                    eq(teamScores.judge_user_id, scores.judge_user_id),
                ),
            )
            .limit(1);
        if (priorScore) {
            throw createError({ statusCode: 409, message: "You already scored this project." });
        }

        const [saved] = await tx
            .insert(teamScores)
            .values({
                team_id: scores.team_id,
                judge_user_id: scores.judge_user_id,
                reasoning: scores.reasoning,
                scores: scores.scores,
                season_id: season.id,
                rubric_version_id: version.id,
            })
            .returning();
        if (!saved) {
            throw createError({ statusCode: 500, message: "Unable to save judge score" });
        }

        await tx
            .delete(judgingDrafts)
            .where(
                and(
                    eq(judgingDrafts.team_id, scores.team_id),
                    eq(judgingDrafts.judge_user_id, scores.judge_user_id),
                ),
            );
        await recalculateTeamScoreAfterSubmission(tx, season.id, team, version);
        return saved;
    });
}

export async function getTeamScoresByTeamID(event: H3Event, teamID: number): Promise<TeamScores[]> {
    return event.context.drizzle.select().from(teamScores).where(eq(teamScores.team_id, teamID));
}

export async function getTeamScoresBySeasonId(
    event: H3Event,
    seasonID: number,
): Promise<TeamScores[]> {
    return event.context.drizzle
        .select()
        .from(teamScores)
        .where(eq(teamScores.season_id, seasonID));
}

/** Count saved judge evaluations for each requested team in one bounded query. */
export async function getTeamEvaluationCounts(
    event: H3Event,
    teamIds: number[],
): Promise<Map<number, number>> {
    if (teamIds.length === 0) return new Map();

    const rows = await event.context.drizzle
        .select({ team_id: teamScores.team_id, evaluation_count: count() })
        .from(teamScores)
        .where(inArray(teamScores.team_id, teamIds))
        .groupBy(teamScores.team_id);
    return new Map(rows.map(({ team_id, evaluation_count }) => [team_id, evaluation_count]));
}
