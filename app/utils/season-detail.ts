export type SeasonScheduleSource = Pick<
    Season,
    | "start_timestamp"
    | "end_timestamp"
    | "voting_start_timestamp"
    | "voting_end_timestamp"
    | "results_open_timestamp"
>;

export function parseSeasonId(value: string | string[] | undefined): number | null {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const seasonId = Number(value);
    return Number.isSafeInteger(seasonId) ? seasonId : null;
}

export function findSeasonById(
    seasons: PublicSeason[] | null | undefined,
    seasonId: number,
): PublicSeason | null {
    return seasons?.find((season) => season.id === seasonId) ?? null;
}

export function getSeasonSchedule(season: SeasonScheduleSource) {
    return [
        { label: "Hackathon starts", value: season.start_timestamp },
        { label: "Hackathon ends", value: season.end_timestamp },
        { label: "Peer voting opens", value: season.voting_start_timestamp },
        { label: "Peer voting closes", value: season.voting_end_timestamp },
        { label: "Results released", value: season.results_open_timestamp },
    ].filter((item) => item.value > 0);
}

export function shouldShowSeasonTheme(season: Pick<Season, "status">): boolean {
    return season.status !== "not_started" && season.status !== "paused";
}
