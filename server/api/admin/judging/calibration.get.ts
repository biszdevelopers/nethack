import { and, eq, inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminSeasonQuery } from "~~/shared/schemas";
import { rubricVersions, teamScores, teams, users } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import {
    calculateWeightedRubricScore,
    getRubricTrack,
    validateRubricScores,
} from "~~/shared/rubric";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

function parseScores(raw: string): Record<string, number> | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return value as Record<string, number>;
    } catch {
        return null;
    }
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, AdminSeasonQuery.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const db = event.context.drizzle;
        const [teamRows, scoreRows, versionRows] = await Promise.all([
            db
                .select({ id: teams.id, pathway: teams.pathway })
                .from(teams)
                .where(
                    and(
                        eq(teams.season_id, season.id),
                        eq(teams.project_submitted, 1),
                        eq(teams.status, "active"),
                    ),
                ),
            db
                .select({
                    judge_user_id: teamScores.judge_user_id,
                    team_id: teamScores.team_id,
                    rubric_version_id: teamScores.rubric_version_id,
                    scores: teamScores.scores,
                })
                .from(teamScores)
                .where(eq(teamScores.season_id, season.id)),
            db
                .select({ id: rubricVersions.id, definition: rubricVersions.definition })
                .from(rubricVersions)
                .where(eq(rubricVersions.season_id, season.id)),
        ]);

        const teamById = new Map(teamRows.map((team) => [team.id, team]));
        const versionById = new Map(versionRows.map((version) => [version.id, version]));
        const byJudge = new Map<number, { sum: number; count: number }>();
        const allScores: number[] = [];

        for (const row of scoreRows) {
            const team = teamById.get(row.team_id);
            const version = versionById.get(row.rubric_version_id);
            if (!team || !version) continue;
            const track = getRubricTrack(version.definition, team.pathway);
            const scores = parseScores(row.scores);
            if (!track || !scores || validateRubricScores(track, scores).length > 0) continue;
            const normalized = calculateWeightedRubricScore(track, scores);
            allScores.push(normalized);
            const judge = byJudge.get(row.judge_user_id) ?? { sum: 0, count: 0 };
            judge.sum += normalized;
            judge.count += 1;
            byJudge.set(row.judge_user_id, judge);
        }

        const overallAverage =
            allScores.length > 0
                ? allScores.reduce((sum, value) => sum + value, 0) / allScores.length
                : null;
        const variance =
            overallAverage === null
                ? 0
                : allScores.reduce((sum, value) => sum + (value - overallAverage) ** 2, 0) /
                  allScores.length;
        const standardDeviation = Math.sqrt(variance);

        const judgeIds = [...byJudge.keys()];
        const judgeRows = judgeIds.length
            ? await db
                  .select({ id: users.id, name: users.name, email: users.email })
                  .from(users)
                  .where(inArray(users.id, judgeIds))
            : [];
        const judgeById = new Map(judgeRows.map((judge) => [judge.id, judge]));

        const judges = judgeIds.map((judgeId) => {
            const totals = byJudge.get(judgeId)!;
            const judge = judgeById.get(judgeId)!;
            const average = totals.sum / totals.count;
            const deviation = average - overallAverage!;
            const outlier =
                totals.count >= 3 &&
                standardDeviation > 0 &&
                Math.abs(deviation) > standardDeviation * 2;
            return {
                judge_user_id: judgeId,
                name: judge.name,
                email: judge.email,
                evaluations: totals.count,
                average: Math.round(average * 100) / 100,
                deviation: Math.round(deviation * 100) / 100,
                outlier,
            };
        });

        return {
            season_id: season.id,
            evaluations: allScores.length,
            overall_average:
                overallAverage === null ? null : Math.round(overallAverage * 100) / 100,
            standard_deviation: Math.round(standardDeviation * 100) / 100,
            judges: judges.sort((left, right) => right.evaluations - left.evaluations),
            outliers: judges.filter((judge) => judge.outlier),
        } satisfies GetJudgingCalibrationResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
