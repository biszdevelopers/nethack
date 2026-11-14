import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import {
    createTeamScores,
    getTeamScoresBySeasonId,
    getTeamScoresByTeamID,
} from "~~/server/utils/database/scores";
import { createMockEvent } from "./helpers";

const completeScores = (value: number) =>
    JSON.stringify(
        Object.fromEntries(
            DEFAULT_RUBRIC_DEFINITION.tracks.junior.criteria.map((criterion) => [
                criterion.id,
                value,
            ]),
        ),
    );

describe("score submission action boundaries", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: ReturnType<
        Awaited<ReturnType<typeof createMockEvent>>["context"]["drizzle"]["getRawDb"]
    >;

    beforeEach(async () => {
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        raw.prepare(
            "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
        ).run();
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(42, 'Active', 1)").run();
        raw.prepare(
            "INSERT INTO rubric_versions(id, season_id, version, name, definition) VALUES(1, 42, 1, 'Current rubric', ?)",
        ).run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        raw.prepare("UPDATE seasons SET rubric_version_id = 1 WHERE id = 42").run();
        raw.prepare(
            "INSERT INTO teams(id, name, season_id, project_submitted, pathway) VALUES(1, 'Submitted team', 42, 1, 'junior')",
        ).run();
        raw.prepare(
            "INSERT INTO users(id, email, role) VALUES(1, 'judge@example.com', 'judge')",
        ).run();
    });

    const submit = (overrides: Partial<Parameters<typeof createTeamScores>[1]> = {}) =>
        createTeamScores(event, {
            team_id: 1,
            season_id: 42,
            judge_user_id: 1,
            scores: completeScores(4),
            reasoning: "A considered review",
            rubric_version_id: 1,
            ...overrides,
        });

    const expectNoSavedScore = () => {
        expect(raw.prepare("SELECT count(*) AS count FROM team_scores").get()).toEqual({
            count: 0,
        });
    };

    it("rejects a season that does not exist and leaves the score table unchanged", async () => {
        await expect(submit({ season_id: 404 })).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "Judging is not open for this season.",
        });
        expectNoSavedScore();
    });

    it("rejects published results even when the season remains marked active", async () => {
        raw.prepare("UPDATE seasons SET results_published = 1 WHERE id = 42").run();

        await expect(submit()).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "Judging is not open for this season.",
        });
        expectNoSavedScore();
    });

    it.each([
        ["a missing team", 404, "Submitted project not found."],
        ["a team from another season", 404, "Submitted project not found."],
        ["a project that has not been submitted", 404, "Submitted project not found."],
    ] as const)("rejects %s before persisting a score", async (caseName) => {
        if (caseName === "a team from another season") {
            raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(43, 'Other', 0)").run();
            raw.prepare(
                "INSERT INTO teams(id, name, season_id, project_submitted, pathway) VALUES(2, 'Other team', 43, 1, 'junior')",
            ).run();
            await expect(submit({ team_id: 2 })).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Submitted project not found.",
            });
        } else if (caseName === "a project that has not been submitted") {
            raw.prepare("UPDATE teams SET project_submitted = 0 WHERE id = 1").run();
            await expect(submit()).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Submitted project not found.",
            });
        } else {
            await expect(submit({ team_id: 404 })).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Submitted project not found.",
            });
        }
        expectNoSavedScore();
    });

    it("rejects a rubric version that is not part of the selected season", async () => {
        raw.prepare("INSERT INTO seasons(id, name, is_active) VALUES(43, 'Other', 0)").run();
        raw.prepare(
            "INSERT INTO rubric_versions(id, season_id, version, name, definition) VALUES(2, 43, 1, 'Other rubric', ?)",
        ).run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));

        await expect(submit({ rubric_version_id: 2 })).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "The selected rubric is unavailable.",
        });
        expectNoSavedScore();
    });

    it.each([null, "unknown-track"] as const)(
        "rejects projects whose pathway %s has no track in the selected rubric",
        async (pathway) => {
            raw.prepare("UPDATE teams SET pathway = ? WHERE id = 1").run(pathway);

            await expect(submit()).rejects.toMatchObject({
                statusCode: 409,
                statusMessage: "No rubric track matches this project.",
            });
            expectNoSavedScore();
        },
    );

    it("rejects malformed JSON before attempting draft or score writes", async () => {
        await expect(submit({ scores: "{" })).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Scores must be valid JSON.",
        });
        expectNoSavedScore();
    });

    it.each(["null", "false", "17", '"text"', "[]"])(
        "rejects parsed JSON value %s because scores must be an object",
        async (scores) => {
            await expect(submit({ scores })).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: "Scores must be an object.",
            });
            expectNoSavedScore();
        },
    );

    it("rejects an unknown criterion with the rubric validation message", async () => {
        const scores = JSON.parse(completeScores(4)) as Record<string, number>;
        scores.unrecognized = 2;

        await expect(submit({ scores: JSON.stringify(scores) })).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Unknown criterion: unrecognized",
        });
        expectNoSavedScore();
    });

    it("rejects a draft pinned to another rubric version and keeps that draft", async () => {
        raw.prepare(
            "INSERT INTO rubric_versions(id, season_id, version, name, definition) VALUES(2, 42, 2, 'New rubric', ?)",
        ).run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        raw.prepare(
            "INSERT INTO judging_drafts(team_id, judge_user_id, rubric_version_id, scores, reasoning) VALUES(1, 1, 2, '{}', 'Draft from next rubric')",
        ).run();

        await expect(submit()).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "Your saved draft uses a different rubric. Reload it before submitting.",
        });
        expectNoSavedScore();
        expect(raw.prepare("SELECT rubric_version_id FROM judging_drafts").get()).toEqual({
            rubric_version_id: 2,
        });
    });

    it("rejects a stale rubric when no saved draft anchors the judge's version", async () => {
        raw.prepare(
            "INSERT INTO rubric_versions(id, season_id, version, name, definition) VALUES(2, 42, 2, 'New rubric', ?)",
        ).run(JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        raw.prepare("UPDATE seasons SET rubric_version_id = 2 WHERE id = 42").run();

        await expect(submit()).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "The rubric changed. Reload the project before scoring.",
        });
        expectNoSavedScore();
    });

    it("rejects duplicate scores by the same judge without disturbing the original", async () => {
        raw.prepare(
            "INSERT INTO team_scores(team_id, judge_user_id, scores, reasoning, season_id, rubric_version_id) VALUES(1, 1, ?, 'Original evaluation', 42, 1)",
        ).run(completeScores(3));

        await expect(submit()).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "You already scored this project.",
        });
        const saved = await getTeamScoresByTeamID(event, 1);
        expect(saved).toHaveLength(1);
        expect(saved[0]?.reasoning).toBe("Original evaluation");
        expect(await getTeamScoresBySeasonId(event, 42)).toHaveLength(1);
    });

    it("rolls back cleanly when the database accepts no row from an insert", async () => {
        raw.exec(`
            CREATE TRIGGER suppress_team_score_insert
            BEFORE INSERT ON team_scores
            BEGIN
                SELECT RAISE(IGNORE);
            END;
        `);
        raw.prepare(
            "INSERT INTO judging_drafts(team_id, judge_user_id, rubric_version_id, scores, reasoning) VALUES(1, 1, 1, '{}', 'Keep until save succeeds')",
        ).run();

        await expect(submit()).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Unable to save judge score",
        });
        expectNoSavedScore();
        expect(raw.prepare("SELECT reasoning FROM judging_drafts").get()).toEqual({
            reasoning: "Keep until save succeeds",
        });
        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = 1").get()).toEqual({
            score: null,
            rank: null,
        });
    });

    it("requests a row lock on the judging-season read when the driver supports it", async () => {
        const database = event.context.drizzle;
        const originalSelect = database.select.bind(database);
        let interceptFirstSelect = true;
        let requestedLock: "update" | undefined;

        const exposeRowLock = (query: any): any =>
            new Proxy(query, {
                get(target, property) {
                    if (property === "for") {
                        return (lock: "update") => {
                            requestedLock = lock;
                            return target;
                        };
                    }
                    const value = Reflect.get(target, property, target);
                    if (typeof value !== "function") return value;
                    if (property === "then") return value.bind(target);
                    return (...args: unknown[]) => exposeRowLock(value.apply(target, args));
                },
            });

        database.select = (...args: unknown[]) => {
            const query = originalSelect(...args);
            if (!interceptFirstSelect) return query;
            interceptFirstSelect = false;
            return exposeRowLock(query);
        };

        const saved = await submit();

        expect(requestedLock).toBe("update");
        expect(saved.team_id).toBe(1);
        expect(await getTeamScoresBySeasonId(event, 42)).toHaveLength(1);
        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = 1").get()).toEqual({
            score: 80,
            rank: 1,
        });
    });

    it("deletes only the submitting judge's draft after the score and ranking are saved", async () => {
        raw.prepare(
            "INSERT INTO users(id, email, role) VALUES(2, 'other-judge@example.com', 'judge')",
        ).run();
        raw.prepare(
            "INSERT INTO judging_drafts(team_id, judge_user_id, rubric_version_id, scores, reasoning) VALUES(1, 1, 1, '{}', 'Submitted draft'), (1, 2, 1, '{}', 'Other judge draft')",
        ).run();

        const saved = await submit();

        expect(saved.team_id).toBe(1);
        expect(saved.rubric_version_id).toBe(1);
        expect(
            raw
                .prepare(
                    "SELECT judge_user_id, reasoning FROM judging_drafts ORDER BY judge_user_id",
                )
                .all(),
        ).toEqual([{ judge_user_id: 2, reasoning: "Other judge draft" }]);
        expect(raw.prepare("SELECT score, rank FROM teams WHERE id = 1").get()).toEqual({
            score: 80,
            rank: 1,
        });
    });
});
