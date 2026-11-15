import { NethackPermissions } from "~~/shared/permissions";
import { SubmitVoteRequest } from "~~/shared/schemas";
import { applyRateLimit, VOTE_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { isVotingOpen } from "~~/server/utils/voting";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const hackathon = await getHackathon(event);
        if (!isVotingOpen(hackathon)) {
            throw createError({
                statusCode: 409,
                message: "Peer voting is closed",
            });
        }

        const user = await requireUser(event, NethackPermissions.Voting.submitOwn);
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

        const payload = await readValidatedBody(event, SubmitVoteRequest.parse);

        const projects = await getSubmittedTeams(event);
        const eligibleProjects = projects.filter(
            (p) => p.id !== user.team_id && p.pathway === userTeam.pathway,
        );

        if (payload.scores.length !== eligibleProjects.length) {
            throw createError({
                statusCode: 403,
                message: `Incorrect number of scores submitted. Expected ${eligibleProjects.length}, got ${payload.scores.length}`,
            });
        }

        const scoreObj: Record<string, number> = {};
        for (let i = 0; i < eligibleProjects.length; i++) {
            scoreObj[eligibleProjects[i]!.id] = payload.scores[i]!;
        }

        await upsertPeerVote(event, {
            user_id: user.id,
            season_id: userTeam.season_id,
            score: JSON.stringify(scoreObj),
            reasoning: payload.reasoning,
        });

        return { message: "Successfully submitted vote!" };
    }, VOTE_RATE_LIMIT_CONFIG),
);
