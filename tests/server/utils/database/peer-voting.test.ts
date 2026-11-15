import { describe, it, expect, beforeEach } from "vitest";
import { createMockEvent } from "./helpers";
import { getPeerVoteByUser, upsertPeerVote } from "~~/server/utils/database/peer-voting";

const SEASON = 1;

describe("peer-voting database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare("INSERT INTO seasons(id, name, is_active) VALUES(1, 'Season 1', 1)")
            .run();
    });

    function insertVote(userID: number, score: string, reasoning: string) {
        event.context.drizzle
            .prepare(
                "INSERT INTO peer_voting_scores(user_id, season_id, score, reasoning) VALUES(?, ?, ?, ?)",
            )
            .bind(userID, SEASON, score, reasoning)
            .run();
    }

    describe("getPeerVoteByUser", () => {
        it("returns the vote when the user has one", async () => {
            insertVote(1, '{"team1":4}', "Good picks");

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote).not.toBeNull();
            expect(vote!.user_id).toBe(1);
            expect(vote!.season_id).toBe(SEASON);
            expect(vote!.score).toBe('{"team1":4}');
            expect(vote!.reasoning).toBe("Good picks");
        });

        it("returns null when the user has no vote", async () => {
            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote).toBeNull();
        });

        it("returns null when the vote belongs to another season", async () => {
            insertVote(1, '{"team1":4}', "Last season");

            await expect(getPeerVoteByUser(event, 1, SEASON + 1)).resolves.toBeNull();
        });

        it("returns the correct vote when multiple users have votes", async () => {
            insertVote(1, '{"team1":4}', "User 1");
            insertVote(2, '{"team2":5}', "User 2");

            const vote = await getPeerVoteByUser(event, 2, SEASON);
            expect(vote!.user_id).toBe(2);
            expect(vote!.score).toBe('{"team2":5}');
        });

        it("returns null for a non-existent user id", async () => {
            const vote = await getPeerVoteByUser(event, 999, SEASON);
            expect(vote).toBeNull();
        });
    });

    describe("upsertPeerVote", () => {
        it("creates a peer vote successfully", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":5,"team2":3}',
                reasoning: "Well reasoned",
            });

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote).not.toBeNull();
            expect(vote!.user_id).toBe(1);
            expect(vote!.score).toBe('{"team1":5,"team2":3}');
            expect(vote!.reasoning).toBe("Well reasoned");
        });

        it("upserts an existing peer vote", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":5}',
                reasoning: "First",
            });
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":4}',
                reasoning: "Second",
            });

            const rows = event.context.drizzle
                .prepare("SELECT * FROM peer_voting_scores WHERE user_id = 1")
                .all() as { results: any[] };
            expect(rows.results).toHaveLength(1);

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote).not.toBeNull();
            expect(vote!.score).toBe('{"team1":4}');
            expect(vote!.reasoning).toBe("Second");
        });

        it("keeps a separate vote per season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(id, name, is_active) VALUES(2, 'Season 2', 0)")
                .run();
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":5}',
                reasoning: "First season",
            });
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: 2,
                score: '{"team2":3}',
                reasoning: "Second season",
            });

            const rows = event.context.drizzle
                .prepare("SELECT * FROM peer_voting_scores WHERE user_id = 1")
                .all() as { results: any[] };
            expect(rows.results).toHaveLength(2);
            expect((await getPeerVoteByUser(event, 1, SEASON))!.score).toBe('{"team1":5}');
            expect((await getPeerVoteByUser(event, 1, 2))!.score).toBe('{"team2":3}');
        });

        it("upserts with null reasoning", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":3}',
                reasoning: null as any,
            });

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote).not.toBeNull();
            expect(vote!.score).toBe('{"team1":3}');
            expect(vote!.reasoning).toBeNull();
        });

        it("upserts with an empty score string", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: "",
                reasoning: "Empty scores",
            });

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote!.score).toBe("");
            expect(vote!.reasoning).toBe("Empty scores");
        });

        it("upserts with a complex JSON score string", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"team1":5,"team2":3,"team3":4}',
                reasoning: "Distributed votes",
            });

            const vote = await getPeerVoteByUser(event, 1, SEASON);
            expect(vote!.score).toBe('{"team1":5,"team2":3,"team3":4}');
        });

        it("ensures only one row per user and season after multiple upserts", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"a":1}',
                reasoning: "A",
            });
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"b":2}',
                reasoning: "B",
            });
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"c":3}',
                reasoning: "C",
            });

            const rows = event.context.drizzle
                .prepare("SELECT * FROM peer_voting_scores WHERE user_id = 1")
                .all() as { results: any[] };
            expect(rows.results).toHaveLength(1);
            expect(rows.results[0]!.score).toBe('{"c":3}');
        });

        it("creates separate votes for different users", async () => {
            await upsertPeerVote(event, {
                user_id: 1,
                season_id: SEASON,
                score: '{"a":1}',
                reasoning: "User 1",
            });
            await upsertPeerVote(event, {
                user_id: 2,
                season_id: SEASON,
                score: '{"b":2}',
                reasoning: "User 2",
            });

            const rows = event.context.drizzle
                .prepare("SELECT * FROM peer_voting_scores")
                .all() as { results: any[] };
            expect(rows.results).toHaveLength(2);
        });
    });
});
