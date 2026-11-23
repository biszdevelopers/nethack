import { NethackPermissions } from "~~/shared/permissions";
import { SubmitVoteRequest } from "~~/shared/schemas";
import { getEventState } from "~~/server/utils/event-state";
import { upsertPeerVote } from "~~/server/utils/database/peer-voting";
import { applyRateLimit, VOTE_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const state = await getEventState(event);
        if (!state.votingOpen) {
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
        if (userTeam.status !== "active") {
            throw createError({
                statusCode: 403,
                message: "Only active participants can vote",
            });
        }

        const payload = await readValidatedBody(event, SubmitVoteRequest.parse);

        const projects = await getSubmittedTeams(event);
        const eligibleProjects = projects.filter(
            (p) => p.id !== userTeam.id && p.status === "active" && p.pathway === userTeam.pathway,
        );

        if (payload.scores.length !== eligibleProjects.length) {
            throw createError({
                statusCode: 400,
                message: `Incorrect number of scores submitted. Expected ${eligibleProjects.length}, got ${payload.scores.length}`,
            });
        }

        // The portal's Max Votes Per User setting caps how many projects may
        // receive stars. Zero means no cap.
        const maxScoredProjects = Math.max(0, Number(state.hackathon?.max_votes_per_user ?? 0));
        if (
            maxScoredProjects > 0 &&
            payload.scores.filter((score) => score > 0).length > maxScoredProjects
        ) {
            throw createError({
                statusCode: 400,
                message: `You can award stars to at most ${maxScoredProjects} projects`,
            });
        }

        const scoreObj: Record<string, number> = {};
        for (let i = 0; i < eligibleProjects.length; i++) {
            scoreObj[eligibleProjects[i]!.id] = payload.scores[i]!;
        }

        await upsertPeerVote(event, {
            user_id: user.id,
            season_id: userTeam.season_id,
            team_id: userTeam.id,
            score: JSON.stringify(scoreObj),
            reasoning: payload.reasoning,
        });

        return { message: "Successfully submitted vote!" };
    }, VOTE_RATE_LIMIT_CONFIG),
);
