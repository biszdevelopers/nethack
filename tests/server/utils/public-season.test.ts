import { describe, expect, it } from "vitest";
import { toPublicSeason } from "~~/server/utils/public-season";

function season(status: string) {
    return {
        id: 1,
        name: "Season",
        is_active: 1,
        status,
        voting_enabled: 0,
        results_published: 0,
        judging_open: 0,
        show_scores: 0,
        show_ranking: 0,
        max_votes_per_user: 0,
        theme_name: "Hidden theme",
        theme_description: "Hidden description",
        start_timestamp: 0,
        end_timestamp: 0,
        voting_start_timestamp: 0,
        voting_end_timestamp: 0,
        results_open_timestamp: 0,
    } as never;
}

describe("toPublicSeason theme visibility", () => {
    it.each(["in_progress", "voting", "finished"])("publishes a theme while %s", (status) => {
        expect(toPublicSeason(season(status)).theme_name).toBe("Hidden theme");
    });

    it.each(["not_started", "paused", "archived"])("hides the theme while %s", (status) => {
        expect(toPublicSeason(season(status)).theme_name).toBeNull();
        expect(toPublicSeason(season(status)).theme_description).toBeNull();
    });
});
