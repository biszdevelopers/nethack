import { beforeEach, describe, expect, it } from "vitest";
import {
    getScoreRankVisibilityResolver,
    setActiveSeason,
    updateSeasonTweaks,
} from "~~/server/utils/database/seasons";
import { createMockEvent } from "./helpers";

describe("season visibility and action boundaries", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp, show_scores, show_ranking) VALUES(1, 'not_started', 0, 0, 0, 0, 0, 1, 1)",
            )
            .run();
    });

    it("uses each season's visibility flags and falls back to live settings for unknown IDs", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, show_scores, show_ranking) VALUES(41, 'Scores only', 0, 1, 0), (42, 'Ranking only', 1, 0, 1)",
            )
            .run();

        const resolveVisibility = await getScoreRankVisibilityResolver(event);

        expect(resolveVisibility(41)).toEqual({ showScores: true, showRanking: false });
        expect(resolveVisibility(42)).toEqual({ showScores: false, showRanking: true });
        expect(resolveVisibility(404)).toEqual({ showScores: true, showRanking: true });
        expect(resolveVisibility(null)).toEqual({ showScores: true, showRanking: true });
        expect(resolveVisibility(undefined)).toEqual({ showScores: true, showRanking: true });
    });

    it("uses disabled visibility when no season or live hackathon row exists", async () => {
        event.context.drizzle.prepare("DELETE FROM hackathon WHERE id = 1").run();

        const resolveVisibility = await getScoreRankVisibilityResolver(event);

        expect(resolveVisibility(1)).toEqual({ showScores: false, showRanking: false });
        expect(resolveVisibility(null)).toEqual({ showScores: false, showRanking: false });
    });

    it("returns a season unchanged when an update contains no tweak fields", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, show_scores) VALUES(1, 'Live', 1, 'voting', 1)",
            )
            .run();

        const result = await updateSeasonTweaks(event, 1, {});

        expect(result).toMatchObject({ id: 1, status: "voting", show_scores: 1 });
        expect(
            event.context.drizzle
                .prepare("SELECT status, show_scores FROM hackathon WHERE id = 1")
                .first(),
        ).toEqual({ status: "not_started", show_scores: 1 });
    });

    it("returns null if the season disappears before the post-update read", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, show_scores) VALUES(1, 'Transient', 0, 1)",
            )
            .run();
        event.context.drizzle.exec(`
            CREATE TRIGGER remove_updated_season
            AFTER UPDATE OF show_scores ON seasons
            WHEN NEW.show_scores = 0
            BEGIN
                DELETE FROM seasons WHERE id = NEW.id;
            END;
        `);

        await expect(updateSeasonTweaks(event, 1, { show_scores: 0 })).resolves.toBeNull();
        expect(
            event.context.drizzle.prepare("SELECT id FROM seasons WHERE id = 1").first(),
        ).toBeUndefined();
    });

    it("copies an activated season's tweak values into live event state", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, show_scores, show_ranking) VALUES(1, 'Next', 0, 'finished', 1, 1)",
            )
            .run();

        await setActiveSeason(event, 1);

        expect(
            event.context.drizzle
                .prepare("SELECT status, show_scores, show_ranking FROM hackathon WHERE id = 1")
                .first(),
        ).toEqual({ status: "finished", show_scores: 1, show_ranking: 1 });
        expect(
            event.context.drizzle.prepare("SELECT is_active FROM seasons WHERE id = 1").first(),
        ).toEqual({ is_active: 1 });
    });
});
