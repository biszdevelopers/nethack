import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    getScoreRankVisibilityResolver,
    getSeasonActivationBlockers,
    isUnconfiguredSeason,
    pickSeasonConfig,
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

        expect(resolveVisibility(41)).toEqual({
            resultsPublished: false,
            showScores: true,
            showRanking: false,
        });
        expect(resolveVisibility(42)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: true,
        });
        expect(resolveVisibility(404)).toEqual({
            resultsPublished: false,
            showScores: true,
            showRanking: true,
        });
        expect(resolveVisibility(null)).toEqual({
            resultsPublished: false,
            showScores: true,
            showRanking: true,
        });
        expect(resolveVisibility(undefined)).toEqual({
            resultsPublished: false,
            showScores: true,
            showRanking: true,
        });
    });

    it("uses disabled visibility when no season or live hackathon row exists", async () => {
        event.context.drizzle.prepare("DELETE FROM hackathon WHERE id = 1").run();

        const resolveVisibility = await getScoreRankVisibilityResolver(event);

        expect(resolveVisibility(1)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: false,
        });
        expect(resolveVisibility(null)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: false,
        });
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

    it("seeds an ordinary unconfigured season from live settings when activated", async () => {
        event.context.drizzle
            .prepare(
                "UPDATE hackathon SET status = 'in_progress', theme_name = 'Current theme', theme_description = 'Current description', start_timestamp = 100, end_timestamp = 200, voting_start_timestamp = 300, voting_end_timestamp = 400 WHERE id = 1",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active) VALUES(11, 'Legacy blank season', 0)",
            )
            .run();

        await setActiveSeason(event, 11);

        expect(
            event.context.drizzle
                .prepare(
                    "SELECT status, theme_name, theme_description, start_timestamp, end_timestamp, is_active FROM seasons WHERE id = 11",
                )
                .first(),
        ).toEqual({
            status: "in_progress",
            theme_name: "Current theme",
            theme_description: "Current description",
            start_timestamp: 100,
            end_timestamp: 200,
            is_active: 1,
        });
    });

    it("rejects activation of a blank-start season without changing its settings", async () => {
        event.context.drizzle
            .prepare(
                "UPDATE hackathon SET status = 'voting', theme_name = 'Live theme', theme_description = 'Live description' WHERE id = 1",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, is_blank_start) VALUES(9, 'Blank', 0, 1)",
            )
            .run();

        await expect(setActiveSeason(event, 9)).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "season_not_ready",
        });

        expect(
            event.context.drizzle
                .prepare(
                    "SELECT status, theme_name, theme_description, start_timestamp, is_active FROM seasons WHERE id = 9",
                )
                .first(),
        ).toEqual({
            status: "not_started",
            theme_name: null,
            theme_description: null,
            start_timestamp: 0,
            is_active: 0,
        });
    });

    it("reports every readiness requirement for a blank-start season", () => {
        expect(
            getSeasonActivationBlockers({
                is_blank_start: 1,
                theme_name: null,
                start_timestamp: 0,
                end_timestamp: 0,
                voting_start_timestamp: 0,
                voting_end_timestamp: 0,
                rubric_version_id: null,
            } as Season),
        ).toEqual(["theme", "event dates", "voting dates", "judging rubric", "board approval"]);
        expect(
            getSeasonActivationBlockers({
                is_blank_start: 1,
                theme_name: "Network Futures",
                start_timestamp: 1,
                end_timestamp: 2,
                voting_start_timestamp: 3,
                voting_end_timestamp: 4,
                rubric_version_id: 5,
                board_approved_at: new Date(),
                board_approved_by: 2,
            } as Season),
        ).toEqual([]);
    });

    it("picks only event settings from a live configuration", () => {
        expect(
            pickSeasonConfig({
                id: 1,
                submitted_count: 4,
                status: "voting",
                theme_name: "Theme",
                unrelated: "ignored",
            }),
        ).toEqual({ status: "voting", theme_name: "Theme" });
        expect(pickSeasonConfig(null)).toEqual({});
    });

    it("treats only a never-configured season as blank", () => {
        const season = {
            status: "not_started",
            theme_name: null,
            theme_description: null,
            start_timestamp: 0,
            end_timestamp: 0,
            voting_start_timestamp: 0,
            voting_end_timestamp: 0,
            results_open_timestamp: 0,
        } as Season;

        expect(isUnconfiguredSeason(season)).toBe(true);
        expect(isUnconfiguredSeason({ ...season, theme_name: "Theme" } as Season)).toBe(false);
        expect(isUnconfiguredSeason({ ...season, start_timestamp: 1 } as Season)).toBe(false);
        expect(isUnconfiguredSeason({ ...season, status: "voting" } as Season)).toBe(false);
    });
});

describe("live YAML season switching", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let manifestDirectory: string;

    beforeEach(async () => {
        manifestDirectory = mkdtempSync(join(tmpdir(), "basishacks-switching-"));
        writeFileSync(
            join(manifestDirectory, "HACKATHON.yml"),
            `id: 1
status: voting
voting_enabled: 1
results_published: 0
show_scores: 0
show_ranking: 0
submitted_count: 0
max_votes_per_user: 1
judging_open: 1
schedule_start: null
schedule_end: null
start_timestamp: 0
end_timestamp: 0
voting_start_timestamp: 0
voting_end_timestamp: 0
results_open_timestamp: 0
theme_name: Live theme
theme_description: Live description
`,
        );
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        vi.stubEnv("HACKATHON_CONFIG_PATH", join(manifestDirectory, "HACKATHON.yml"));
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
            )
            .run();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(manifestDirectory, { recursive: true, force: true });
    });

    it("refuses to change live settings on the active season", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status) VALUES(1, 'Live', 1, 'voting')",
            )
            .run();

        await expect(updateSeasonTweaks(event, 1, { show_scores: 0 })).rejects.toMatchObject({
            statusCode: 409,
        });
    });

    it("snapshots the outgoing live manifest into its active season when switching", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, show_scores) VALUES(1, 'Outgoing', 1, 'not_started', 0), (2, 'Incoming', 0, 'finished', 1)",
            )
            .run();

        await setActiveSeason(event, 2);

        expect(
            event.context.drizzle
                .prepare("SELECT status, is_active FROM seasons WHERE id = 1")
                .first(),
        ).toEqual({ status: "voting", is_active: 0 });
        expect(
            event.context.drizzle
                .prepare("SELECT status, is_active FROM seasons WHERE id = 2")
                .first(),
        ).toEqual({ status: "finished", is_active: 1 });
    });

    it("does not re-snapshot a season that is already the live one", async () => {
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status) VALUES(1, 'Current', 1, 'not_started')",
            )
            .run();

        await setActiveSeason(event, 1);

        expect(
            event.context.drizzle
                .prepare("SELECT status, is_active FROM seasons WHERE id = 1")
                .first(),
        ).toEqual({ status: "not_started", is_active: 1 });
    });
});
