import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
export default defineEventHandler(
    applyRateLimit(async (event) => {
        const season = await getActiveSeason(event);
        const hackathon = await getHackathon(event);

        if (!hackathon) {
            throw createError({
                statusCode: 404,
                message: "No active season found",
            });
        }

        const showTheme = hackathon.status !== "not_started" && hackathon.status !== "paused";

        return {
            id: season?.id,
            name: season?.name,
            is_active: season?.is_active,
            status: hackathon.status,
            start_timestamp: hackathon.start_timestamp,
            end_timestamp: hackathon.end_timestamp,
            voting_start_timestamp: hackathon.voting_start_timestamp,
            voting_end_timestamp: hackathon.voting_end_timestamp,
            results_open_timestamp: hackathon.results_open_timestamp,
            judging_open: !!hackathon.judging_open,
            show_scores: !!hackathon.show_scores,
            show_ranking: !!hackathon.show_ranking,
            theme_name: showTheme ? hackathon.theme_name : null,
            theme_description: showTheme ? hackathon.theme_description : null,
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
