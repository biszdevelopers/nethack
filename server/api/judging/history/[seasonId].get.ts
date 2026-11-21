import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { JudgingHistoryParams } from "~~/shared/schemas";
import {
    calculateWeightedRubricScore,
    getRubricTrack,
    validateRubricScores,
} from "~~/shared/rubric";
import type { Team } from "~~/shared/database";
import { teamScores, teams as teamsTable } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getRubricVersionsByIds } from "~~/server/utils/scoring";

/** Only the columns the public project payload reads (never internal team columns). */
const historyTeamColumns = {
    id: teamsTable.id,
    name: teamsTable.name,
    pathway: teamsTable.pathway,
    score: teamsTable.score,
    rank: teamsTable.rank,
    project_name: teamsTable.project_name,
    project_description: teamsTable.project_description,
    project_demo_url: teamsTable.project_demo_url,
    project_repo_url: teamsTable.project_repo_url,
    project_video_url: teamsTable.project_video_url,
    project_submitted: teamsTable.project_submitted,
    status: teamsTable.status,
    sourcing: teamsTable.sourcing,
    season_id: teamsTable.season_id,
};

/** Optional keyset pagination; without it the full history is returned as before. */
const HistoryPagination = z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    after: z.coerce.number().int().positive().optional(),
});

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

        const pagination = HistoryPagination.safeParse(getQuery(event));
        if (!pagination.success) {
            throw createError({ statusCode: 400, message: "Invalid pagination parameters." });
        }
        const { limit, after } = pagination.data;

        const season = await getSeasonById(event, seasonId);
        if (!season) throw createError({ statusCode: 404, message: "Season not found." });

        const where = and(
            eq(teamScores.judge_user_id, user.id),
            eq(teamsTable.season_id, seasonId),
            after === undefined ? undefined : gt(teamsTable.id, after),
        );
        const historyQuery = event.context.drizzle
            .select({
                team: historyTeamColumns,
                scores: teamScores.scores,
                reasoning: teamScores.reasoning,
                rubric_version_id: teamScores.rubric_version_id,
            })
            .from(teamScores)
            .innerJoin(teamsTable, eq(teamsTable.id, teamScores.team_id))
            .where(where)
            .orderBy(asc(teamsTable.id));
        const rows = limit === undefined ? await historyQuery : await historyQuery.limit(limit);

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
        // Rubric versions are immutable, so this id lookup is safely cacheable.
        const versionsById = await getRubricVersionsByIds(event.context.drizzle, versionIds);
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
            const team = convertTeamToPublic(
                row.team as unknown as Team,
                { withScore: false, withRank: false },
                awardsByTeam[row.team.id] ?? [],
            );

            if (!version || !track || !scores || validateRubricScores(track, scores).length > 0) {
                unavailable += 1;
                // Keep the project details and the judge's written feedback
                // reviewable even when the immutable rubric is gone.
                items.push({
                    team,
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
                team,
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

        const payload = {
            season: { id: season.id, name: season.name },
            items,
            unavailable_evaluations: unavailable,
        };
        if (limit === undefined) return payload satisfies GetJudgingHistoryResponse;
        return {
            ...payload,
            next_cursor: rows.length === limit ? rows[rows.length - 1]!.team.id : null,
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
