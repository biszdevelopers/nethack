import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getEventState } from "~~/server/utils/event-state";
import { isJudgingOpen } from "~~/server/utils/judging";
import { isVotingOpen } from "~~/server/utils/voting";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const state = await getEventState(event);
        const season = state.season;
        const hackathon = state.hackathon;

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
            is_judging_open: isJudgingOpen(hackathon, season),
            is_voting_open: isVotingOpen(hackathon, { enforceDeadlines: state.enforceDeadlines }),
            max_team_members: season?.max_team_members ?? 6,
            is_submission_closed: state.submissionsClosed,
            is_gallery_public: state.galleryPublic,
            results_published: hackathon.results_published,
            show_scores: !!hackathon.show_scores,
            show_ranking: !!hackathon.show_ranking,
            theme_name: showTheme ? hackathon.theme_name : null,
            theme_description: showTheme ? hackathon.theme_description : null,
            announcement: hackathon.announcement ?? null,
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
