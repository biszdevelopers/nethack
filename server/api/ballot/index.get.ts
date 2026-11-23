import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { getEventState } from "~~/server/utils/event-state";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const state = await getEventState(event);
        if (!state.votingOpen) {
            throw createError({
                statusCode: 409,
                message: "Peer voting is closed",
            });
        }

        const user = await requireUser(event, NethackPermissions.Voting.readOwn);
        if (!user.team_id) {
            throw createError({
                statusCode: 403,
                message: "Only participants can vote",
            });
        }

        const userTeam = await getTeam(event, user.team_id);
        if (!userTeam?.project_submitted) {
            throw createError({
                statusCode: 403,
                message: "Only participants with submitted projects can vote",
            });
        }
        if (userTeam.status !== "active") {
            throw createError({
                statusCode: 403,
                message: "Only active participants can vote",
            });
        }

        const projects = await getSubmittedTeams(event);
        const eligibleProjects = projects.filter(
            (p) => p.id !== userTeam.id && p.status === "active" && p.pathway === userTeam.pathway,
        );

        const peerVote = await getPeerVoteByUser(event, user.id, userTeam.season_id);

        let scores: number[] = eligibleProjects.map(() => 0);
        let reasoning: string | null = null;
        let submitted = false;

        if (peerVote) {
            submitted = true;
            reasoning = peerVote.reasoning;
            try {
                const scoreObj = JSON.parse(peerVote.score) as Record<string, number>;
                scores = eligibleProjects.map((p) => scoreObj[p.id] ?? 0);
            } catch {
                scores = eligibleProjects.map(() => 0);
            }
        }

        return {
            submitted,
            projects: eligibleProjects.map((t) =>
                convertTeamToPublic(t, { withScore: false, withRank: false }),
            ),
            scores,
            reasoning,
            max_votes_per_user: Math.max(0, Number(state.hackathon?.max_votes_per_user ?? 0)),
        } satisfies GetBallotResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
