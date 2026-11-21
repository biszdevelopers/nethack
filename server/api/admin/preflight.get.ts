import { and, count, countDistinct, eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { AdminSeasonQuery } from "~~/shared/schemas";
import { judgeAssignments, teamScores, teams } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { getEventState } from "~~/server/utils/event-state";
import { MIN_PUBLIC_FEEDBACK_REVIEWERS } from "~~/server/utils/score-feedback";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, AdminSeasonQuery.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const db = event.context.drizzle;
        const submittedWhere = and(eq(teams.season_id, season.id), eq(teams.project_submitted, 1));
        const [submittedRows, evaluationRows, pathRows, judgeRows, assignedRows, state] =
            await Promise.all([
                db.select({ value: count() }).from(teams).where(submittedWhere),
                db
                    .select({ team_id: teamScores.team_id, value: count() })
                    .from(teamScores)
                    .where(eq(teamScores.season_id, season.id))
                    .groupBy(teamScores.team_id),
                db
                    .select({ pathway: teams.pathway, value: count() })
                    .from(teams)
                    .where(and(submittedWhere, eq(teams.status, "active")))
                    .groupBy(teams.pathway),
                db
                    .select({ value: countDistinct(teamScores.judge_user_id) })
                    .from(teamScores)
                    .where(eq(teamScores.season_id, season.id)),
                db
                    .select({ value: countDistinct(judgeAssignments.judge_user_id) })
                    .from(judgeAssignments)
                    .where(eq(judgeAssignments.season_id, season.id)),
                getEventState(event),
            ]);

        const submitted = Number(submittedRows[0]?.value ?? 0);
        const evaluatedTeams = new Set(evaluationRows.map((row) => row.team_id));
        const belowMinimum =
            Math.max(0, submitted - evaluatedTeams.size) +
            evaluationRows.filter((row) => Number(row.value) < MIN_PUBLIC_FEEDBACK_REVIEWERS)
                .length;
        const evaluationsTotal = evaluationRows.reduce((sum, row) => sum + Number(row.value), 0);
        const maxEligibleProjects = pathRows.reduce(
            (max, row) => Math.max(max, Math.max(0, Number(row.value) - 1)),
            0,
        );
        const cap = Math.max(0, season.max_votes_per_user);
        const feasible =
            maxEligibleProjects >= 2 && (cap === 0 || Math.min(cap, maxEligibleProjects) * 5 >= 10);
        const finishedWithoutResults =
            season.status === "finished" && season.results_published !== 1 ? 1 : 0;
        const publishedWithoutTimestamp =
            season.results_published === 1 && !season.results_published_at ? 1 : 0;
        const missingEventEnd = season.end_timestamp <= 0 ? 1 : 0;
        const invalidDateRange =
            (season.start_timestamp > 0 &&
                season.end_timestamp > 0 &&
                season.end_timestamp < season.start_timestamp) ||
            (season.voting_start_timestamp > 0 &&
                season.voting_end_timestamp > 0 &&
                season.voting_end_timestamp < season.voting_start_timestamp)
                ? 1
                : 0;

        return {
            season_id: season.id,
            submitted_teams: submitted,
            teams_below_minimum_evaluations: belowMinimum,
            evaluations_total: evaluationsTotal,
            judges_with_evaluations: Number(judgeRows[0]?.value ?? 0),
            assigned_judges: Number(assignedRows[0]?.value ?? 0),
            mismatches: {
                finished_without_results: finishedWithoutResults,
                published_without_timestamp: publishedWithoutTimestamp,
                missing_event_end: missingEventEnd,
                invalid_date_range: invalidDateRange,
            },
            vote_cap: {
                max_votes_per_user: cap,
                max_eligible_projects: maxEligibleProjects,
                feasible,
            },
            gates: {
                submissions_open: state.submissionsOpen,
                voting_open: state.votingOpen,
                judging_open: state.judgingOpen,
                gallery_public: state.galleryPublic,
                results_visible: state.resultsVisible,
            },
        } satisfies AdminPreflightResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
