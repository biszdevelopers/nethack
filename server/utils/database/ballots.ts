import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { ballots, ballotScores } from "~~/server/database/schema";
import { changedRows, firstRow } from "./query";

export async function createBallot(event: H3Event, userID: number): Promise<Ballot> {
    return (await firstRow(
        event.context.drizzle.insert(ballots).values({ user_id: userID }).returning(),
    ))!;
}

export async function getBallotByUser(event: H3Event, userID: number): Promise<Ballot | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(ballots).where(eq(ballots.user_id, userID)).limit(1),
    );

    return row ?? null;
}

export async function updateBallot(event: H3Event, ballot: Ballot): Promise<void> {
    const changed = await changedRows(
        event.context.drizzle
            .update(ballots)
            .set({ reasoning: ballot.reasoning, submitted: ballot.submitted })
            .where(eq(ballots.id, ballot.id))
            .returning({ id: ballots.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "Ballot not found",
        });
    }
}

export async function createBallotScore(
    event: H3Event,
    ballotID: number,
    projectID: number,
): Promise<BallotScore> {
    return (await firstRow(
        event.context.drizzle
            .insert(ballotScores)
            .values({ ballot_id: ballotID, project_id: projectID })
            .returning(),
    ))!;
}

export async function getBallotScores(event: H3Event, ballotID: number): Promise<BallotScore[]> {
    return event.context.drizzle
        .select()
        .from(ballotScores)
        .where(eq(ballotScores.ballot_id, ballotID));
}

export async function getBallotScoresByTeamID(
    event: H3Event,
    teamID: number,
): Promise<BallotScore[]> {
    return event.context.drizzle
        .select()
        .from(ballotScores)
        .where(eq(ballotScores.project_id, teamID));
}

export async function updateBallotScore(event: H3Event, score: BallotScore) {
    const changed = await changedRows(
        event.context.drizzle
            .update(ballotScores)
            .set({ score: score.score })
            .where(eq(ballotScores.id, score.id))
            .returning({ id: ballotScores.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "Ballot score not found",
        });
    }
}
