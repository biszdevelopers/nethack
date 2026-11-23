import { NethackPermissions } from "~~/shared/permissions";
import { SubmitTeamRequest, TeamIdParams } from "~~/shared/schemas";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";
import { getEventState } from "~~/server/utils/event-state";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const user = await requireUser(event, NethackPermissions.Projects.submitOwn);
        if (user?.team_id !== id) {
            throw createError({
                status: 403,
                message: "Cannot submit other projects",
            });
        }

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                status: 403,
                message: state.paused
                    ? "The event is paused"
                    : state.hackathon?.status === "finished" || state.hackathon?.status === "voting"
                      ? "Cannot submit project when hackathon is finished"
                      : "Cannot submit project after submissions close",
            });
        }

        const payload = await readValidatedBody(event, SubmitTeamRequest.parse);

        const team = await getTeam(event, id);

        if (!team) {
            throw createError({
                status: 404,
                message: "Team not found or not accessible currently",
            });
        }

        if (team.project_submitted) {
            throw createError({
                statusCode: 409,
                message: "Project is already submitted",
            });
        }
        if (team.status !== "active") {
            throw createError({
                statusCode: 409,
                message: "This team is no longer competing",
            });
        }

        const rubric = await getRubricVersionForSeason(event, team.season_id);
        if (!rubric || !Object.hasOwn(rubric.definition.tracks, payload.pathway)) {
            throw createError({
                statusCode: 400,
                message: "Choose a track that is available for this season.",
            });
        }

        team.pathway = payload.pathway;
        team.project_name = payload.project.name;
        team.project_description = payload.project.description;
        team.project_demo_url = payload.project.demo_url;
        team.project_repo_url = payload.project.repo_url;
        team.project_video_url = payload.project.video_url;
        team.sourcing = payload.project.sourcing;
        team.project_submitted = 1;
        team.submitted_at = new Date();

        // Write only the submission columns, and only while the team is still
        // active and unsubmitted. A concurrent disband/withdrawal must not be
        // reverted by a stale full-row write.
        await updateTeamPartial(
            event,
            id,
            team.season_id,
            {
                pathway: team.pathway,
                project_name: team.project_name,
                project_description: team.project_description,
                project_demo_url: team.project_demo_url,
                project_repo_url: team.project_repo_url,
                project_video_url: team.project_video_url,
                sourcing: team.sourcing,
                project_submitted: 1,
                submitted_at: team.submitted_at,
            },
            { requireUnsubmitted: true, requireActive: true },
        );

        return { message: "Successfully submitted project" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
