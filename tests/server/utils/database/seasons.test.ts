import { describe, it, expect, beforeEach } from "vitest";
import { createMockEvent } from "./helpers";
import {
    getSeasons,
    getSeasonById,
    getActiveSeason,
    setActiveSeason,
    updateSeasonTweaks,
} from "~~/server/utils/database/seasons";

describe("seasons database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
    });

    describe("getSeasons", () => {
        it("returns all seasons ordered by id", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 1', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 2', 1)")
                .run();

            const seasons = await getSeasons(event);
            expect(seasons).toHaveLength(2);
            expect(seasons[0]!.name).toBe("Season 1");
            expect(seasons[1]!.name).toBe("Season 2");
        });

        it("returns an empty array when there are no seasons", async () => {
            const seasons = await getSeasons(event);
            expect(seasons).toHaveLength(0);
        });

        it("returns seasons with all expected fields", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Test Season', 1)")
                .run();

            const seasons = await getSeasons(event);
            expect(seasons[0]!.id).toBe(1);
            expect(seasons[0]!.name).toBe("Test Season");
            expect(seasons[0]!.is_active).toBe(1);
        });

        it("returns seasons with mixed active and inactive status", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('B', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('C', 0)")
                .run();

            const seasons = await getSeasons(event);
            expect(seasons).toHaveLength(3);
            expect(seasons[0]!.is_active).toBe(1);
            expect(seasons[1]!.is_active).toBe(0);
            expect(seasons[2]!.is_active).toBe(0);
        });
    });

    describe("getSeasonById", () => {
        it("returns the season when it exists", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 1', 1)")
                .run();

            const season = await getSeasonById(event, 1);
            expect(season).not.toBeNull();
            expect(season!.name).toBe("Season 1");
        });

        it("returns null when the season does not exist", async () => {
            const season = await getSeasonById(event, 999);
            expect(season).toBeNull();
        });

        it("returns the correct season for a specific id", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Alpha', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Beta', 1)")
                .run();

            const season = await getSeasonById(event, 2);
            expect(season!.id).toBe(2);
            expect(season!.name).toBe("Beta");
        });

        it("returns all fields for the season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Full', 1)")
                .run();

            const season = await getSeasonById(event, 1);
            expect(season!.id).toBe(1);
            expect(season!.name).toBe("Full");
            expect(season!.is_active).toBe(1);
        });
    });

    describe("getActiveSeason", () => {
        it("returns the active season when one exists", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Inactive', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Active', 1)")
                .run();

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.name).toBe("Active");
        });

        it("returns null when there is no active season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Inactive', 0)")
                .run();

            const season = await getActiveSeason(event);
            expect(season).toBeNull();
        });

        it("returns null when no seasons exist at all", async () => {
            const season = await getActiveSeason(event);
            expect(season).toBeNull();
        });

        it("only returns the single active season when multiple inactive seasons exist", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('A', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('B', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('C', 0)")
                .run();

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.name).toBe("B");
            expect(season!.is_active).toBe(1);
        });

        it("returns the active season with all fields", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Full', 1)")
                .run();

            const season = await getActiveSeason(event);
            expect(season!.id).toBe(1);
            expect(season!.name).toBe("Full");
            expect(season!.is_active).toBe(1);
        });
    });

    describe("setActiveSeason", () => {
        it("sets a season as active", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 1', 0)")
                .run();

            await setActiveSeason(event, 1);

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.name).toBe("Season 1");
        });

        it("deactivates all seasons when given null", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 1', 1)")
                .run();

            await setActiveSeason(event, null);

            const season = await getActiveSeason(event);
            expect(season).toBeNull();
        });

        it("throws a 404 error when setting a non-existing season as active", async () => {
            await expect(setActiveSeason(event, 999)).rejects.toThrow("Season not found");
        });

        it("leaves the active season unchanged when the target season does not exist", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Active', 1)")
                .run();

            await expect(setActiveSeason(event, 999)).rejects.toThrow("Season not found");

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.name).toBe("Active");
        });

        it("switches active season from one to another", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Old', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('New', 0)")
                .run();

            await setActiveSeason(event, 2);

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.id).toBe(2);
            expect(season!.name).toBe("New");

            // Old season should be inactive
            const oldSeason = await getSeasonById(event, 1);
            expect(oldSeason!.is_active).toBe(0);
        });

        it("mirrors every activated season setting onto the live singleton", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO seasons(name, is_active, status, theme_name, judging_open, start_timestamp) VALUES('Old', 1, 'voting', 'Old theme', 1, 111)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO seasons(name, is_active, status, theme_name, judging_open, start_timestamp) VALUES('New', 0, 'finished', 'New theme', 0, 222)",
                )
                .run();

            await setActiveSeason(event, 2);

            const live = event.context.drizzle
                .prepare(
                    "SELECT status, theme_name, judging_open, start_timestamp FROM hackathon WHERE id = 1",
                )
                .first();

            expect(live).toEqual({
                status: "finished",
                theme_name: "New theme",
                judging_open: 0,
                start_timestamp: 222,
            });
        });

        it("activates a season when no other season is active", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Solo', 0)")
                .run();

            await setActiveSeason(event, 1);

            const season = await getActiveSeason(event);
            expect(season).not.toBeNull();
            expect(season!.id).toBe(1);
            expect(season!.is_active).toBe(1);
        });

        it("deactivates all seasons when called with null and multiple seasons exist", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('B', 0)")
                .run();

            await setActiveSeason(event, null);

            const season = await getActiveSeason(event);
            expect(season).toBeNull();

            // All should be inactive
            const all = await getSeasons(event);
            expect(all.every((s) => s.is_active === 0)).toBe(true);
        });

        it("throws a 404 when activating non-existing season with other seasons present", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Existing', 1)")
                .run();

            await expect(setActiveSeason(event, 999)).rejects.toThrow("Season not found");
        });

        it("allows setActiveSeason(null) when no seasons exist", async () => {
            // No seasons seeded
            await setActiveSeason(event, null);

            const season = await getActiveSeason(event);
            expect(season).toBeNull();
        });
    });

    describe("updateSeasonTweaks", () => {
        it("updates the given fields on the season and returns the updated row", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Season 1', 0)")
                .run();

            const updated = await updateSeasonTweaks(event, 1, {
                status: "voting",
                show_scores: 1,
            });

            expect(updated).not.toBeNull();
            expect(updated!.status).toBe("voting");
            expect(updated!.show_scores).toBe(1);
        });

        it("leaves other fields untouched", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO seasons(name, is_active, status, show_scores) VALUES('Season 1', 0, 'in_progress', 1)",
                )
                .run();

            const updated = await updateSeasonTweaks(event, 1, { show_ranking: 1 });

            expect(updated!.status).toBe("in_progress");
            expect(updated!.show_scores).toBe(1);
            expect(updated!.show_ranking).toBe(1);
        });

        it("returns null when the season does not exist", async () => {
            const updated = await updateSeasonTweaks(event, 999, { show_scores: 1 });
            expect(updated).toBeNull();
        });

        it("also updates the hackathon row when the season is live", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
                )
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Live', 1)")
                .run();

            await updateSeasonTweaks(event, 1, { show_scores: 1, show_ranking: 1 });

            const hackathon = event.context.drizzle
                .prepare("SELECT * FROM hackathon WHERE id = 1")
                .first() as any;
            expect(hackathon.show_scores).toBe(1);
            expect(hackathon.show_ranking).toBe(1);
        });

        it("does not touch the hackathon row when the season is not live", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
                )
                .run();
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Future', 0)")
                .run();

            await updateSeasonTweaks(event, 1, { show_scores: 1 });

            const hackathon = event.context.drizzle
                .prepare("SELECT * FROM hackathon WHERE id = 1")
                .first() as any;
            expect(hackathon.show_scores).toBe(0);
        });
    });
});
