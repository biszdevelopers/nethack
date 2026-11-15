export function toPublicSeason(season: Season): PublicSeason {
    const themeIsPublished = season.status !== "not_started" && season.status !== "paused";

    return {
        id: season.id,
        name: season.name,
        is_active: season.is_active,
        status: season.status,
        results_published: season.results_published,
        start_timestamp: season.start_timestamp,
        end_timestamp: season.end_timestamp,
        voting_start_timestamp: season.voting_start_timestamp,
        voting_end_timestamp: season.voting_end_timestamp,
        results_open_timestamp: season.results_open_timestamp,
        theme_name: themeIsPublished ? season.theme_name : null,
        theme_description: themeIsPublished ? season.theme_description : null,
    } satisfies PublicSeason;
}
