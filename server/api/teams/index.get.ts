import { and, asc, count, eq, inArray } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { GetTeamsQuery } from "~~/shared/schemas";
import { teamScores, teams as teamsTable } from "~~/server/database/schema";
import { isJudgingOpen } from "~~/server/utils/judging";

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, GetTeamsQuery.parse);

    if (query.judging) {
        const { id: userID } = await requireUser(event, NethackPermissions.Judging.assignmentsRead);

        const hackathon = await getHackathon(event);
        if (!isJudgingOpen(hackathon)) {
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
            const where = and(
                eq(teamsTable.season_id, season.id),
                eq(teamsTable.project_submitted, 1),
            );
            const [countRows, pageTeams] = await Promise.all([
                event.context.drizzle.select({ total: count() }).from(teamsTable).where(where),
                event.context.drizzle
                    .select()
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
                            team as Team,
                            { withScore: false },
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

        const teams = await getSubmittedUnjudgedTeams(event, userID);
        const awardsByTeam = await getAwardsForTeams(
            event,
            teams.map((t) => t.id),
        );

        return teams.map((t) =>
            convertTeamToPublic(t, { withScore: false }, awardsByTeam[t.id] ?? []),
        );
    } else {
        const seasonId = query.season_id ?? -1;
        const teams =
            seasonId === -1 ? await getAllTeams(event) : await getTeamsBySeason(event, seasonId);
        const awardsByTeam = await getAwardsForTeams(
            event,
            teams.map((t) => t.id),
        );

        // Public listing: ranks are only exposed when the team's own season
        // has the ranking toggle enabled
        const resolveVisibility = await getScoreRankVisibilityResolver(event);

        return teams.map((t) =>
            convertTeamToPublic(
                t,
                { withRank: resolveVisibility(t.season_id).showRanking },
                awardsByTeam[t.id] ?? [],
            ),
        );
    }
});
