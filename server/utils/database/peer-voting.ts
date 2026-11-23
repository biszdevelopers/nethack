import type { H3Event } from "h3";
import { and, eq } from "drizzle-orm";
import { peerVotingScores } from "~~/server/database/schema";
import { firstRow } from "./query";

export async function getPeerVoteByUser(
    event: H3Event,
    userID: number,
    seasonID: number,
): Promise<PeerVotingScore | null> {
    const row = await firstRow(
        event.context.drizzle
            .select()
            .from(peerVotingScores)
            .where(
                and(eq(peerVotingScores.user_id, userID), eq(peerVotingScores.season_id, seasonID)),
            )
            .limit(1),
    );

    return row ?? null;
}

export async function upsertPeerVote(
    event: H3Event,
    vote: {
        user_id: number;
        season_id: number;
        team_id?: number | null;
        score: string;
        reasoning: string;
    },
): Promise<void> {
    const values = { ...vote, team_id: vote.team_id ?? null };
    await event.context.drizzle
        .insert(peerVotingScores)
        .values(values)
        .onConflictDoUpdate({
            target: [peerVotingScores.user_id, peerVotingScores.season_id],
            set: {
                team_id: values.team_id,
                score: vote.score,
                reasoning: vote.reasoning,
            },
        });
}
