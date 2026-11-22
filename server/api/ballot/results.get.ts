import { and, eq } from "drizzle-orm";
import { NethackPermissions, hasNethackPermission } from "~~/shared/permissions";
import { AdminSeasonQuery } from "~~/shared/schemas";
import { peerVotingScores, teams } from "~~/server/database/schema";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { getEventState, isPeopleChoiceEnabled } from "~~/server/utils/event-state";
import { isVotingOpen, summarizePeerVoting } from "~~/server/utils/voting";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (!isPeopleChoiceEnabled()) {
            throw createError({ statusCode: 404, message: "Peer-voting results are disabled" });
        }
        const state = await getEventState(event);
        const query = await getValidatedQuery(event, AdminSeasonQuery.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const isActiveSeason = season.is_active === 1;
        // A historical season is closed by definition; the active season's
        // voting window must not block its published results.
        const votingClosed = isActiveSeason
            ? !isVotingOpen(state.hackathon, { enforceDeadlines: state.enforceDeadlines })
            : true;
        if (!votingClosed) {
            throw createError({ statusCode: 409, message: "Peer voting is still open" });
        }

        // Read the identity first so a privileged cookie session is recognized
        // before the public gates below run.
        await optionalUser(event);
        const privileged = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.Judging.assignmentsRead,
        );
        if (isActiveSeason && !state.galleryPublic && !privileged) {
            throw createError({
                statusCode: 403,
                message: "Peer-voting results are available after submissions close",
            });
        }

        const resultsVisible = isActiveSeason
            ? !state.paused && state.resultsVisible
            : season.results_published === 1;
        if (!resultsVisible && !privileged) {
            throw createError({
                statusCode: 403,
                message: "Peer-voting results are not published yet",
            });
        }

        const db = event.context.drizzle;
        const [seasonTeams, ballots] = await Promise.all([
            db
                .select({
                    id: teams.id,
                    name: teams.name,
                    pathway: teams.pathway,
                    project_submitted: teams.project_submitted,
                    status: teams.status,
                })
                .from(teams)
                .where(and(eq(teams.season_id, season.id), eq(teams.status, "active"))),
            db
                .select({
                    user_id: peerVotingScores.user_id,
                    team_id: peerVotingScores.team_id,
                    score: peerVotingScores.score,
                })
                .from(peerVotingScores)
                .where(eq(peerVotingScores.season_id, season.id)),
        ]);

        const submittedProjects = seasonTeams.filter((team) => team.project_submitted === 1);
        // A withdrawn or disqualified team's ballots no longer count; turnout is
        // measured only across teams still competing.
        const activeTeamIds = new Set(seasonTeams.map((team) => team.id));
        const eligibleBallots = ballots.filter(
            (ballot) => ballot.team_id === null || activeTeamIds.has(ballot.team_id),
        );
        const summary = summarizePeerVoting(
            submittedProjects.map((team) => ({
                team_id: team.id,
                name: team.name,
                pathway: team.pathway,
            })),
            eligibleBallots,
        );
        const projectById = new Map(submittedProjects.map((team) => [team.id, team]));
        const projects = summary.projects.map((project) => {
            const team = projectById.get(project.team_id)!;
            return {
                team_id: project.team_id,
                name: team.name,
                pathway: team.pathway,
                average_stars: project.average_stars,
                team_units: project.team_units,
            } satisfies BallotResultsProject;
        });

        return {
            season_id: season.id,
            results_visible: resultsVisible,
            voting_closed: votingClosed,
            turnout: {
                submitted_teams: submittedProjects.length,
                voting_teams: summary.votingTeams,
                ballots: summary.ballots,
                turnout_ratio:
                    submittedProjects.length > 0
                        ? Math.round((summary.votingTeams / submittedProjects.length) * 10000) /
                          10000
                        : 0,
            },
            projects,
        } satisfies BallotResultsResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
