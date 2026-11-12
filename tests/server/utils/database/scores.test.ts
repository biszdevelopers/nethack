import { describe, it, expect, beforeEach } from "vitest";
import { createMockEvent } from "./helpers";
import {
    createTeamScores,
    getTeamScoresByTeamID,
    getTeamScoresBySeasonId,
} from "~~/server/utils/database/scores";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

const defaultScores = (value: number) =>
    JSON.stringify(
        Object.fromEntries(
            DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                criterion.id,
                value,
            ]),
        ),
    );

describe("scores database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        // Seed hackathon with id 1 (different from active season to catch the bug)
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
            )
            .run();
        // Seed an active season with a non-1 id
        event.context.drizzle
            .prepare("INSERT INTO seasons(id, name, is_active) VALUES(42, 'S42', 1)")
            .run();
        const rawDb = event.context.drizzle.getRawDb();
        const rubric = rawDb
            .prepare(
                "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(42, 1, 'Test rubric', ?)",
            )
            .run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        rawDb
            .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = 42")
            .run(Number(rubric.lastInsertRowid));
        event.context.drizzle
            .prepare(
                "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Team A', 42, 1, 'junior')",
            )
            .run();
        // Seed a judge user
        event.context.drizzle
            .prepare("INSERT INTO users(email, role) VALUES('judge@example.com', 'judge')")
            .run();
    });

    describe("createTeamScores", () => {
        it("creates team scores and tags them with the active season id", async () => {
            const scores = await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 1,
                scores: defaultScores(4),
                reasoning: "Great project overall",
                rubric_version_id: 1,
            });

            expect(scores).not.toBeNull();
            expect(scores.team_id).toBe(1);
            expect(scores.judge_user_id).toBe(1);
            expect(scores.scores).toBe(defaultScores(4));
            expect(scores.reasoning).toBe("Great project overall");
            expect(scores.season_id).toBe(42);
        });

        it("creates team scores with null reasoning (default applied)", async () => {
            const scores = await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 1,
                scores: defaultScores(3),
                rubric_version_id: 1,
            } as any);

            expect(scores).not.toBeNull();
            expect(scores.scores).toBe(defaultScores(3));
            // reasoning defaults to '<no reasoning provided>' when not provided
            expect(scores.reasoning).toBe("<no reasoning provided>");
        });

        it("rejects scores when there is no active season rubric", async () => {
            // Deactivate the only season
            event.context.drizzle.prepare("UPDATE seasons SET is_active = 0").run();

            await expect(
                createTeamScores(event, {
                    team_id: 1,
                    season_id: 42,
                    judge_user_id: 1,
                    scores: defaultScores(4),
                    reasoning: "No season test",
                    rubric_version_id: 1,
                }),
            ).rejects.toThrow("Judging is not open for this season");
            expect(
                event.context.drizzle
                    .getRawDb()
                    .prepare("SELECT count(*) AS count FROM team_scores")
                    .get().count,
            ).toBe(0);
        });

        it("creates multiple scores for the same team from different judges", async () => {
            event.context.drizzle
                .prepare("INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')")
                .run();

            const scores1 = await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 1,
                scores: defaultScores(5),
                reasoning: "Judge 1",
                rubric_version_id: 1,
            });
            const scores2 = await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 2,
                scores: defaultScores(4),
                reasoning: "Judge 2",
                rubric_version_id: 1,
            });

            const all = await getTeamScoresByTeamID(event, 1);
            expect(all).toHaveLength(2);
            expect(all[0]!.judge_user_id).not.toBe(all[1]!.judge_user_id);
            expect(
                event.context.drizzle
                    .getRawDb()
                    .prepare("SELECT score, rank FROM teams WHERE id = 1")
                    .get(),
            ).toEqual({ score: 90, rank: 1 });
        });

        it("updates only affected rankings in the scored track", async () => {
            const raw = event.context.drizzle.getRawDb();
            const juniorId = Number(
                raw
                    .prepare(
                        "INSERT INTO teams(name, season_id, project_submitted, pathway, score, rank) VALUES('Junior B', 42, 1, 'junior', 80, 1)",
                    )
                    .run().lastInsertRowid,
            );
            const seniorId = Number(
                raw
                    .prepare(
                        "INSERT INTO teams(name, season_id, project_submitted, pathway, score, rank) VALUES('Senior A', 42, 1, 'senior', 50, 1)",
                    )
                    .run().lastInsertRowid,
            );
            raw.prepare(
                "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(?, 1, ?, '', 42, 1)",
            ).run(juniorId, defaultScores(4));

            await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 1,
                scores: defaultScores(5),
                reasoning: "A higher score",
                rubric_version_id: 1,
            });

            expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(1)).toEqual({
                score: 100,
                rank: 1,
            });
            expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(juniorId)).toEqual(
                {
                    score: 80,
                    rank: 2,
                },
            );
            expect(raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(seniorId)).toEqual(
                {
                    score: 50,
                    rank: 1,
                },
            );
        });

        it("matches full ranking recalculation for a submitted project with no judge scores", async () => {
            const raw = event.context.drizzle.getRawDb();
            const unscoredId = Number(
                raw
                    .prepare(
                        "INSERT INTO teams(name, season_id, project_submitted, pathway) VALUES('Not yet judged', 42, 1, 'junior')",
                    )
                    .run().lastInsertRowid,
            );

            await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 1,
                scores: defaultScores(5),
                reasoning: "Scored project",
                rubric_version_id: 1,
            });

            expect(
                raw.prepare("SELECT score, rank FROM teams WHERE id = ?").get(unscoredId),
            ).toEqual({
                score: 0,
                rank: 2,
            });
        });

        it("averages earlier evaluations against their pinned rubric version", async () => {
            const raw = event.context.drizzle.getRawDb();
            const secondVersionId = Number(
                raw
                    .prepare(
                        "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(42, 2, 'Updated rubric', ?)",
                    )
                    .run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION)).lastInsertRowid,
            );
            raw.prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = 42").run(
                secondVersionId,
            );
            raw.prepare(
                "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(1, 1, ?, 'Previous version', 42, 1)",
            ).run(defaultScores(4));
            raw.prepare(
                "INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')",
            ).run();

            await createTeamScores(event, {
                team_id: 1,
                season_id: 42,
                judge_user_id: 2,
                scores: defaultScores(5),
                reasoning: "Current version",
                rubric_version_id: secondVersionId,
            });

            expect(raw.prepare("SELECT score, rank FROM teams WHERE id = 1").get()).toEqual({
                score: 90,
                rank: 1,
            });
        });

        it("does not finalize a submission when an earlier saved rubric version is missing", async () => {
            const raw = event.context.drizzle.getRawDb();
            raw.prepare(
                "INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')",
            ).run();
            raw.prepare(
                "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(1, 1, ?, 'Broken history', 42, 999)",
            ).run(defaultScores(4));

            await expect(
                createTeamScores(event, {
                    team_id: 1,
                    season_id: 42,
                    judge_user_id: 2,
                    scores: defaultScores(5),
                    reasoning: "Should roll back",
                    rubric_version_id: 1,
                }),
            ).rejects.toMatchObject({
                statusCode: 409,
                message: "A saved judge score is missing its team or rubric version.",
            });
            expect(
                raw
                    .prepare("SELECT count(*) AS count FROM team_scores WHERE judge_user_id = 2")
                    .get(),
            ).toEqual({ count: 0 });
        });

        it("rejects a saved rubric version that belongs to a different season", async () => {
            const raw = event.context.drizzle.getRawDb();
            raw.prepare(
                "INSERT INTO seasons(id, name, is_active) VALUES(43, 'Other Season', 0)",
            ).run();
            const foreignVersionId = Number(
                raw
                    .prepare(
                        "INSERT INTO rubric_versions(season_id, version, name, definition) VALUES(43, 1, 'Other season rubric', ?)",
                    )
                    .run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION)).lastInsertRowid,
            );
            raw.prepare(
                "INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')",
            ).run();
            raw.prepare(
                "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(1, 1, ?, 'Foreign rubric', 42, ?)",
            ).run(defaultScores(4), foreignVersionId);

            await expect(
                createTeamScores(event, {
                    team_id: 1,
                    season_id: 42,
                    judge_user_id: 2,
                    scores: defaultScores(5),
                    reasoning: "Should roll back",
                    rubric_version_id: 1,
                }),
            ).rejects.toMatchObject({
                statusCode: 409,
                message: "A saved judge score is missing its team or rubric version.",
            });
            expect(
                raw
                    .prepare("SELECT count(*) AS count FROM team_scores WHERE judge_user_id = 2")
                    .get(),
            ).toEqual({ count: 0 });
        });

        it("rejects incomplete scores before saving them", async () => {
            await expect(
                createTeamScores(event, {
                    team_id: 1,
                    season_id: 42,
                    judge_user_id: 1,
                    scores: "{}",
                    reasoning: "Empty scores",
                    rubric_version_id: 1,
                }),
            ).rejects.toThrow("Missing score");

            expect(
                event.context.drizzle
                    .getRawDb()
                    .prepare("SELECT count(*) AS count FROM team_scores")
                    .get().count,
            ).toBe(0);
        });
    });

    describe("getTeamScoresByTeamID", () => {
        it("returns scores for a team that has them", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning) VALUES(1, 1, '{\"innovation\":3}', 'Decent')",
                )
                .run();

            const scores = await getTeamScoresByTeamID(event, 1);
            expect(scores).toHaveLength(1);
            expect(scores[0]!.team_id).toBe(1);
            expect(scores[0]!.judge_user_id).toBe(1);
        });

        it("returns an empty array when the team has no scores", async () => {
            const scores = await getTeamScoresByTeamID(event, 1);
            expect(scores).toHaveLength(0);
        });

        it("returns multiple scores for the same team", async () => {
            event.context.drizzle
                .prepare("INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')")
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning) VALUES(1, 1, '{\"a\":1}', 'First'), (1, 2, '{\"b\":2}', 'Second')",
                )
                .run();

            const scores = await getTeamScoresByTeamID(event, 1);
            expect(scores).toHaveLength(2);
        });

        it("returns only scores for the requested team", async () => {
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 42)")
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning) VALUES(1, 1, '{\"a\":1}', 'Team A'), (2, 1, '{\"b\":2}', 'Team B')",
                )
                .run();

            const scores = await getTeamScoresByTeamID(event, 2);
            expect(scores).toHaveLength(1);
            expect(scores[0]!.team_id).toBe(2);
        });

        it("returns an empty array for a non-existent team id", async () => {
            const scores = await getTeamScoresByTeamID(event, 999);
            expect(scores).toHaveLength(0);
        });
    });

    describe("getTeamScoresBySeasonId", () => {
        it("returns scores for a season that has them", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id) VALUES(1, 1, '{\"innovation\":3}', 'Decent', 42)",
                )
                .run();

            const scores = await getTeamScoresBySeasonId(event, 42);
            expect(scores).toHaveLength(1);
            expect(scores[0]!.team_id).toBe(1);
            expect(scores[0]!.season_id).toBe(42);
        });

        it("returns an empty array when the season has no scores", async () => {
            const scores = await getTeamScoresBySeasonId(event, 42);
            expect(scores).toHaveLength(0);
        });

        it("returns multiple scores in the same season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 42)")
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id) VALUES(1, 1, '{\"a\":1}', 'First', 42), (2, 2, '{\"b\":2}', 'Second', 42)",
                )
                .run();

            const scores = await getTeamScoresBySeasonId(event, 42);
            expect(scores).toHaveLength(2);
        });

        it("returns scores only for the requested season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('S99', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 43)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, role) VALUES('judge2@example.com', 'judge')")
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id) VALUES(1, 1, '{\"a\":1}', 'S42', 42), (2, 2, '{\"b\":2}', 'S43', 43)",
                )
                .run();

            const scores = await getTeamScoresBySeasonId(event, 43);
            expect(scores).toHaveLength(1);
            expect(scores[0]!.season_id).toBe(43);
        });

        it("returns an empty array for a non-existent season id", async () => {
            const scores = await getTeamScoresBySeasonId(event, 999);
            expect(scores).toHaveLength(0);
        });
    });
});
