import { NethackPermissions } from "~~/shared/permissions";
import { SubmitTeamRequest, TeamIdParams } from "~~/shared/schemas";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";
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

        const hackathon = await getHackathon(event);
        if (hackathon?.status !== "in_progress" && hackathon?.status !== "not_started") {
            throw createError({
                status: 403,
                message: "Cannot submit project when hackathon is finished",
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
                status: 403,
                message: "Project is already submitted",
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
        team.sourcing = payload.project.sourcing ?? "";
        team.project_submitted = 1;

        await updateTeam(event, team);

        return { message: "Successfully submitted project" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
