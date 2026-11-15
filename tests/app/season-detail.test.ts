import {
    findSeasonById,
    getSeasonSchedule,
    parseSeasonId,
    shouldShowSeasonTheme,
} from "~/app/utils/season-detail";

describe("season detail helpers", () => {
    const season = {
        id: 4,
        name: "Season Four",
        is_active: 0,
        status: "finished",
        voting_enabled: 1,
        results_published: 1,
        judging_open: 0,
        show_scores: 1,
        show_ranking: 1,
        max_votes_per_user: 10,
        schedule_start: null,
        schedule_end: null,
        start_timestamp: 100,
        end_timestamp: 200,
        voting_start_timestamp: 300,
        voting_end_timestamp: 400,
        results_open_timestamp: 500,
        theme_name: "Build Better Tools",
        theme_description: "A test theme.",
        score_curve_preset: "original" as const,
        rubric_version_id: 2,
    } satisfies Season;

    it.each([
        ["4", 4],
        ["42", 42],
        [undefined, null],
        ["", null],
        ["0", null],
        ["-1", null],
        ["1.2", null],
        ["1e2", null],
        ["9007199254740992", null],
        [["4"], null],
    ])("parses season route ID %j", (input, expected) => {
        expect(parseSeasonId(input as string | string[] | undefined)).toBe(expected);
    });

    it("selects the matching season and handles missing data or IDs", () => {
        expect(findSeasonById([season], 4)).toEqual(season);
        expect(findSeasonById([season], 5)).toBeNull();
        expect(findSeasonById(undefined, 4)).toBeNull();
    });

    it("keeps only dates that have been configured", () => {
        expect(
            getSeasonSchedule({
                start_timestamp: 0,
                end_timestamp: 200,
                voting_start_timestamp: 0,
                voting_end_timestamp: 400,
                results_open_timestamp: 0,
            }),
        ).toEqual([
            { label: "Hackathon ends", value: 200 },
            { label: "Peer voting closes", value: 400 },
        ]);
    });

    it.each([
        ["not_started", false],
        ["paused", false],
        ["in_progress", true],
        ["voting", true],
        ["finished", true],
    ])("theme visibility for %s season is %s", (status, visible) => {
        expect(shouldShowSeasonTheme({ status } as Season)).toBe(visible);
    });
});
