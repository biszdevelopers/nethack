import { NethackPermissions } from "~~/shared/permissions";
import { UpdateTeamRequest, TeamIdParams } from "~~/shared/schemas";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const user = await requireUser(event, NethackPermissions.Projects.updateOwn);
        if (user?.team_id !== id) {
            throw createError({
                status: 403,
                message: "Cannot edit other teams",
            });
        }

        const hackathon = await getHackathon(event);
        if (hackathon?.status !== "not_started" && hackathon?.status !== "in_progress") {
            throw createError({
                status: 403,
                message: "Cannot edit team and project after hackathon has finished",
            });
        }

        const payload = await readValidatedBody(event, UpdateTeamRequest.parse);

        const team = (await getTeam(event, id, true))!;
        if (team.project_submitted) {
            throw createError({
                status: 403,
                message: "Project is already submitted",
            });
        }

        if (payload.pathway !== undefined) {
            const rubric = await getRubricVersionForSeason(event, team.season_id);
            if (!rubric?.definition.tracks[payload.pathway]) {
                throw createError({
                    statusCode: 400,
                    message: "Choose a track that is available for this season.",
                });
            }
        }

        if (payload.name !== undefined) team.name = payload.name;
        if (payload.pathway !== undefined) team.pathway = payload.pathway;
        if (payload.project?.name !== undefined) team.project_name = payload.project.name;
        if (payload.project?.description !== undefined)
            team.project_description = payload.project.description;
        if (payload.project?.demo_url !== undefined)
            team.project_demo_url = payload.project.demo_url;
        if (payload.project?.repo_url !== undefined)
            team.project_repo_url = payload.project.repo_url;
        if (payload.project?.sourcing !== undefined) team.sourcing = payload.project.sourcing;

        await updateTeam(event, team);

        return { message: "Updated your team & project" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
