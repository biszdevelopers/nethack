import { and, asc, eq, inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgingHistoryParams } from "~~/shared/schemas";
import {
    calculateWeightedRubricScore,
    getRubricTrack,
    validateRubricScores,
} from "~~/shared/rubric";
import type { Team } from "~~/shared/database";
import { rubricVersions, teamScores, teams as teamsTable } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

function parseStoredScores(raw: string): Record<string, number> | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (Object.values(value).some((score) => typeof score !== "number")) return null;
    return value as Record<string, number>;
}

/**
 * Read-only history of one judge's finalized evaluations for a season, so
 * completed work stays reviewable after judging closes.
 */
export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { seasonId } = await getValidatedRouterParams(event, JudgingHistoryParams.parse);
        const user = await requireUser(event, NethackPermissions.Judging.assignmentsRead);

        const season = await getSeasonById(event, seasonId);
        if (!season) throw createError({ statusCode: 404, message: "Season not found." });

        const rows = await event.context.drizzle
            .select({
                team: teamsTable,
                scores: teamScores.scores,
                reasoning: teamScores.reasoning,
                rubric_version_id: teamScores.rubric_version_id,
            })
            .from(teamScores)
            .innerJoin(teamsTable, eq(teamsTable.id, teamScores.team_id))
            .where(and(eq(teamScores.judge_user_id, user.id), eq(teamsTable.season_id, seasonId)))
            .orderBy(asc(teamsTable.id));

        if (rows.length === 0) {
            return {
                season: { id: season.id, name: season.name },
                items: [],
                unavailable_evaluations: 0,
            } satisfies GetJudgingHistoryResponse;
        }

        const versionIds = [
            ...new Set(
                rows
                    .map((row) => row.rubric_version_id)
                    .filter((id): id is number => typeof id === "number"),
            ),
        ];
        const versions = versionIds.length
            ? await event.context.drizzle
                  .select()
                  .from(rubricVersions)
                  .where(inArray(rubricVersions.id, versionIds))
            : [];
        const versionsById = new Map(versions.map((version) => [version.id, version]));
        const awardsByTeam = await getAwardsForTeams(
            event,
            rows.map((row) => row.team.id),
        );

        let unavailable = 0;
        const items: JudgingHistoryItem[] = [];
        for (const row of rows) {
            const version =
                row.rubric_version_id === null
                    ? undefined
                    : versionsById.get(row.rubric_version_id);
            const track = getRubricTrack(version?.definition, row.team.pathway);
            const scores = parseStoredScores(row.scores);

            if (!version || !track || !scores || validateRubricScores(track, scores).length > 0) {
                unavailable += 1;
                // Keep the project details and the judge's written feedback
                // reviewable even when the immutable rubric is gone.
                items.push({
                    team: convertTeamToPublic(
                        row.team as Team,
                        { withScore: false, withRank: false },
                        awardsByTeam[row.team.id] ?? [],
                    ),
                    rubric_name: version?.name ?? "Unavailable rubric",
                    rubric_version: version?.version ?? 0,
                    track_name: track?.name ?? "Unavailable track",
                    normalized_score: null,
                    scores: scores ?? {},
                    criteria: track?.criteria ?? [],
                    reasoning: row.reasoning,
                    unavailable: true,
                });
                continue;
            }

            items.push({
                team: convertTeamToPublic(
                    row.team as Team,
                    { withScore: false, withRank: false },
                    awardsByTeam[row.team.id] ?? [],
                ),
                rubric_name: version.name,
                rubric_version: version.version,
                track_name: track.name,
                normalized_score:
                    Math.round(calculateWeightedRubricScore(track, scores) * 100) / 100,
                scores,
                criteria: track.criteria,
                reasoning: row.reasoning,
            });
        }

        return {
            season: { id: season.id, name: season.name },
            items,
            unavailable_evaluations: unavailable,
        } satisfies GetJudgingHistoryResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
