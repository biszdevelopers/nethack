import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import type { H3Event } from "h3";
import { and, asc, count, eq, gt, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions, hasNethackPermission } from "~~/shared/permissions";
import { GetTeamsQuery } from "~~/shared/schemas";
import { teamScores, teams as teamsTable } from "~~/server/database/schema";
import { isJudgingOpen, getJudgeScope, judgeScopeWhere } from "~~/server/utils/judging";
import { getEventState } from "~~/server/utils/event-state";
import { getTeamEvaluationCounts } from "~~/server/utils/database/scores";
import { MIN_PUBLIC_FEEDBACK_REVIEWERS } from "~~/server/utils/score-feedback";

/** Only the columns the public project payload reads (never internal team columns). */
const publicTeamColumns = {
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

/** Optional keyset pagination; without `limit` the full array response is unchanged. */
const ListingPagination = z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    after: z.coerce.number().int().positive().optional(),
});

async function queryPublicTeams(event: H3Event, seasonId: number, limit?: number, after?: number) {
    const query = event.context.drizzle
        .select(publicTeamColumns)
        .from(teamsTable)
        .where(
            and(
                eq(teamsTable.season_id, seasonId),
                eq(teamsTable.project_submitted, 1),
                eq(teamsTable.status, "active"),
                after === undefined ? undefined : gt(teamsTable.id, after),
            ),
        )
        .orderBy(asc(teamsTable.id));
    return limit === undefined ? await query : await query.limit(limit);
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const query = await getValidatedQuery(event, GetTeamsQuery.parse);
        const pagination = ListingPagination.safeParse(getQuery(event));
        if (!pagination.success) {
            throw createError({ statusCode: 400, message: "Invalid pagination parameters." });
        }
        const { limit, after } = pagination.data;

        if (query.judging) {
            const judge = await requireUser(event, NethackPermissions.Judging.assignmentsRead);
            const userID = judge.id;

            const state = await getEventState(event);
            const hackathon = state.hackathon;
            if (!isJudgingOpen(hackathon, state.season)) {
                throw createError({
                    statusCode: 403,
                    message: "Judging is not open",
                });
            }

            if (query.page !== undefined || query.page_size !== undefined) {
                const season = await getActiveSeason(event);
                const page = query.page ?? 1;
                const pageSize = query.page_size ?? 20;
                if (!season) {
                    return {
                        items: [],
                        page,
                        page_size: pageSize,
                        total: 0,
                        total_pages: 0,
                    } satisfies GetJudgingQueueResponse;
                }

                // Keep evaluated projects in their stable page positions. If the
                // queue only contained unscored projects, submitting page 1 would
                // shift every later page and could make a judge skip projects.
                // Judges cannot score their own team, so it never enters the queue.
                const scope = state.season
                    ? await getJudgeScope(event.context.drizzle, state.season.id, userID)
                    : null;
                const scopeWhere = scope ? judgeScopeWhere(scope) : undefined;
                const where = and(
                    eq(teamsTable.season_id, season.id),
                    eq(teamsTable.project_submitted, 1),
                    eq(teamsTable.status, "active"),
                    ne(teamsTable.id, judge.team_id ?? -1),
                    scopeWhere,
                );
                const [countRows, pageTeams] = await Promise.all([
                    event.context.drizzle.select({ total: count() }).from(teamsTable).where(where),
                    event.context.drizzle
                        .select(publicTeamColumns)
                        .from(teamsTable)
                        .where(where)
                        .orderBy(asc(teamsTable.id))
                        .limit(pageSize)
                        .offset((page - 1) * pageSize),
                ]);
                const total = Number(countRows[0]?.total ?? 0);
                const teamIds = pageTeams.map((team) => team.id);
                const [awardsByTeam, evaluations] = await Promise.all([
                    getAwardsForTeams(event, teamIds),
                    teamIds.length > 0
                        ? event.context.drizzle
                              .select({
                                  team_id: teamScores.team_id,
                                  scores: teamScores.scores,
                                  reasoning: teamScores.reasoning,
                              })
                              .from(teamScores)
                              .where(
                                  and(
                                      eq(teamScores.judge_user_id, userID),
                                      inArray(teamScores.team_id, teamIds),
                                  ),
                              )
                        : Promise.resolve([]),
                ]);
                const evaluationByTeam = new Map(
                    evaluations.map((evaluation) => {
                        let scores: Record<string, number> = {};
                        try {
                            const parsed: unknown = JSON.parse(evaluation.scores);
                            if (
                                parsed &&
                                typeof parsed === "object" &&
                                !Array.isArray(parsed) &&
                                Object.values(parsed).every((value) => typeof value === "number")
                            ) {
                                scores = parsed as Record<string, number>;
                            }
                        } catch {
                            // Preserve the evaluated status even if a historical
                            // score payload cannot be displayed safely.
                        }
                        return [evaluation.team_id, { scores, reasoning: evaluation.reasoning }];
                    }),
                );

                return {
                    items: pageTeams.map((team) => {
                        const evaluation = evaluationByTeam.get(team.id) ?? null;
                        return {
                            team: convertTeamToPublic(
                                team as unknown as Team,
                                { withScore: false, withRank: false },
                                awardsByTeam[team.id] ?? [],
                            ),
                            evaluated: evaluation !== null,
                            evaluation,
                        };
                    }),
                    page,
                    page_size: pageSize,
                    total,
                    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
                } satisfies GetJudgingQueueResponse;
            }

            const scope = state.season
                ? await getJudgeScope(event.context.drizzle, state.season.id, userID)
                : null;
            const teams = await getSubmittedUnjudgedTeams(
                event,
                userID,
                judge.team_id,
                scope ? judgeScopeWhere(scope) : undefined,
            );
            const awardsByTeam = await getAwardsForTeams(
                event,
                teams.map((t) => t.id),
            );

            return teams.map((t) =>
                convertTeamToPublic(
                    t,
                    { withScore: false, withRank: false },
                    awardsByTeam[t.id] ?? [],
                ),
            );
        } else {
            const state = await getEventState(event);
            const requestedSeasonId =
                query.season_id === undefined ? state.season?.id : query.season_id;
            const rows = await queryPublicTeams(event, requestedSeasonId ?? -1, limit, after);
            let teams = rows;

            // Before submissions close, an active-season project is visible only
            // to its own members, judging staff, and administrators. Historical
            // seasons keep their published archive.
            if (
                !state.galleryPublic &&
                state.season !== null &&
                requestedSeasonId === state.season.id
            ) {
                const viewer = await optionalUser(event);
                const privileged = hasNethackPermission(
                    event.context.oauth2?.permissions,
                    NethackPermissions.Judging.assignmentsRead,
                );
                const viewerTeam = viewer?.team_id
                    ? ((await getTeam(event, viewer.team_id))?.id ?? null)
                    : null;
                teams = teams.filter(
                    (team) => privileged || (viewerTeam !== null && team.id === viewerTeam),
                );
            }

            const awardsByTeam = await getAwardsForTeams(
                event,
                teams.map((t) => t.id),
            );

            // Public listing: ranks are only exposed when the team's own season
            // has published results, enabled ranking, and enough judge evaluations.
            const resolveVisibility = await getScoreRankVisibilityResolver(event);
            const evaluationsByTeam = await getTeamEvaluationCounts(
                event,
                teams.map((team) => team.id),
            );

            const items = teams.map((team) => {
                const visibility = resolveVisibility(team.season_id);
                const meetsAnonymityThreshold =
                    (evaluationsByTeam.get(team.id) ?? 0) >= MIN_PUBLIC_FEEDBACK_REVIEWERS;
                return convertTeamToPublic(
                    team as unknown as Team,
                    {
                        withRank:
                            visibility.resultsPublished &&
                            visibility.showRanking &&
                            meetsAnonymityThreshold,
                    },
                    visibility.resultsPublished ? (awardsByTeam[team.id] ?? []) : [],
                );
            });

            if (limit === undefined) return items;
            const lastRow = rows[rows.length - 1];
            return {
                items,
                next_cursor: rows.length === limit && lastRow ? lastRow.id : null,
            };
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
