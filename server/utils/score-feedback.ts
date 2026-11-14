import { eq, inArray } from "drizzle-orm";
import type { H3Event } from "h3";
import { applyScoreCurve, isScoreCurvePreset, SCORE_CURVE_PRESETS } from "~~/shared/score-curve";
import { calculateWeightedRubricScore, validateRubricScores } from "~~/shared/rubric";
import { rubricVersions, seasons, teamScores, users } from "~~/server/database/schema";
import type { Team } from "~~/shared/database";
import { firstRow } from "~~/server/utils/database/query";

export const MIN_PUBLIC_FEEDBACK_REVIEWERS = 3;

export interface TeamScoreFeedbackOptions {
    /** Competitor view applies the anonymous-reviewer threshold before returning comments. */
    publicView?: boolean;
    /** Administrator view may identify the judge who authored each evaluation. */
    includeJudgeIdentity?: boolean;
}

function parseScoreObject(raw: string): Record<string, number> {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw createError({ statusCode: 409, message: "Saved score feedback is unavailable." });
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw createError({ statusCode: 409, message: "Saved score feedback is unavailable." });
    }

    return value as Record<string, number>;
}

/** Resolve per-team score detail without returning judge identity. */
export async function getTeamScoreFeedback(
    event: H3Event,
    team: Team,
    options: TeamScoreFeedbackOptions = {},
) {
    const db = event.context.drizzle;
    const [season, evaluations] = await Promise.all([
        firstRow(db.select().from(seasons).where(eq(seasons.id, team.season_id)).limit(1)),
        db.select().from(teamScores).where(eq(teamScores.team_id, team.id)),
    ]);

    if (!season) throw createError({ statusCode: 404, message: "Season not found." });

    const versionIds = [...new Set(evaluations.map((evaluation) => evaluation.rubric_version_id))];
    const judgeIds = [...new Set(evaluations.map((evaluation) => evaluation.judge_user_id))];
    const versions = versionIds.length
        ? await db.select().from(rubricVersions).where(inArray(rubricVersions.id, versionIds))
        : [];
    const judges =
        options.includeJudgeIdentity && judgeIds.length
            ? await db
                  .select({ id: users.id, name: users.name })
                  .from(users)
                  .where(inArray(users.id, judgeIds))
            : [];
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const judgesById = new Map(judges.map((judge) => [judge.id, judge]));

    let total = 0;
    const feedback = evaluations.map((evaluation) => {
        const version = versionsById.get(evaluation.rubric_version_id);
        const track = team.pathway ? version?.definition.tracks[team.pathway] : undefined;
        if (!version || !track) {
            throw createError({ statusCode: 409, message: "Saved score feedback is unavailable." });
        }

        const scores = parseScoreObject(evaluation.scores);
        if (validateRubricScores(track, scores).length > 0) {
            throw createError({ statusCode: 409, message: "Saved score feedback is unavailable." });
        }

        const exactNormalizedScore = calculateWeightedRubricScore(track, scores);
        total += exactNormalizedScore;

        const entry = {
            rubric_name: version.name,
            rubric_version: version.version,
            track_name: track.name,
            normalized_score: Math.round(exactNormalizedScore * 100) / 100,
            scores,
            criteria: track.criteria,
            reasoning: evaluation.reasoning,
        };
        return options.includeJudgeIdentity
            ? {
                  ...entry,
                  judge_id: evaluation.judge_user_id,
                  judge_name: judgesById.get(evaluation.judge_user_id)?.name ?? null,
              }
            : entry;
    });

    // Do not expose stable judge ordering or identifiers in either feedback view.
    for (let index = feedback.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [feedback[index], feedback[swapIndex]] = [feedback[swapIndex]!, feedback[index]!];
    }

    const rawScore =
        evaluations.length > 0 ? Math.round(total / evaluations.length) : (team.score ?? null);
    const feedbackWithheldForAnonymity =
        options.publicView === true && evaluations.length < MIN_PUBLIC_FEEDBACK_REVIEWERS;
    const visibleFeedback = feedbackWithheldForAnonymity
        ? []
        : options.publicView === true
          ? feedback.map(({ reasoning }) => ({ reasoning }))
          : feedback;
    const curvePreset = isScoreCurvePreset(season.score_curve_preset)
        ? season.score_curve_preset
        : "original";
    const displayedScore = rawScore === null ? null : applyScoreCurve(rawScore, curvePreset);

    return {
        team_id: team.id,
        season_id: season.id,
        original_score: rawScore,
        displayed_score: displayedScore,
        curve_preset: curvePreset,
        curve_label: curvePreset === "original" ? null : SCORE_CURVE_PRESETS[curvePreset].label,
        rank: team.rank,
        feedback: visibleFeedback,
        ...(options.publicView === true
            ? { feedback_withheld_for_anonymity: feedbackWithheldForAnonymity }
            : {}),
    };
}
