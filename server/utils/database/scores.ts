import type { H3Event } from "h3";
import { and, eq } from "drizzle-orm";
import {
    judgingDrafts,
    rubricVersions,
    seasons,
    teamScores,
    teams,
} from "~~/server/database/schema";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { validateRubricScores } from "~~/shared/rubric";

type NewTeamScore = Pick<
    TeamScores,
    "team_id" | "judge_user_id" | "scores" | "reasoning" | "rubric_version_id"
> & { season_id: number };

function lockForUpdateIfSupported<T>(query: T): T {
    const lockable = query as T & { for?: (lock: "update") => T };
    return typeof lockable.for === "function" ? lockable.for("update") : query;
}

export async function createTeamScores(event: H3Event, scores: NewTeamScore): Promise<TeamScores> {
    return event.context.drizzle.transaction(async (tx) => {
        const seasonQuery = lockForUpdateIfSupported(
            tx.select().from(seasons).where(eq(seasons.id, scores.season_id)).limit(1),
        );
        const [season] = await seasonQuery;
        if (!season || season.is_active !== 1 || season.results_published) {
            throw createError({ statusCode: 409, message: "Judging is not open for this season." });
        }

        const [team] = await tx.select().from(teams).where(eq(teams.id, scores.team_id)).limit(1);
        if (!team || team.season_id !== season.id || !team.project_submitted) {
            throw createError({ statusCode: 404, message: "Submitted project not found." });
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

        const track = team.pathway ? version.definition.tracks[team.pathway] : undefined;
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
        await calculateSeasonScoresWithDatabase(tx, season.id, true);
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
