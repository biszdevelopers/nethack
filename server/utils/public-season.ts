export function toPublicSeason(
    season: Season,
    options: { is_submission_closed?: boolean; is_gallery_public?: boolean } = {},
): PublicSeason {
    // Allowlist the published phases: an unexpected legacy status must not
    // reveal a theme that the organizer never published.
    const themeIsPublished =
        season.status === "in_progress" ||
        season.status === "voting" ||
        season.status === "finished";

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
        is_submission_closed: options.is_submission_closed,
        is_gallery_public: options.is_gallery_public,
    } satisfies PublicSeason;
}
