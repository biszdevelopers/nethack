import { NethackPermissions } from "~~/shared/permissions";
import { UpdateTeamRequest, TeamIdParams } from "~~/shared/schemas";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";
import type { teams } from "~~/server/database/schema";
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

        // Only the active season's team is editable; an archived team is
        // readable history, not a draft.
        const team = await getTeam(event, id);
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        if (team.project_submitted) {
            throw createError({
                statusCode: 409,
                message: "Project is already submitted",
            });
        }

        if (payload.pathway !== undefined) {
            const rubric = await getRubricVersionForSeason(event, team.season_id);
            if (!rubric || !Object.hasOwn(rubric.definition.tracks, payload.pathway)) {
                throw createError({
                    statusCode: 400,
                    message: "Choose a track that is available for this season.",
                });
            }
        }

        // Send only the supplied columns so a concurrent edit of a different
        // field is preserved.
        const updates: Partial<typeof teams.$inferInsert> = {};
        if (payload.name !== undefined) updates.name = payload.name;
        if (payload.pathway !== undefined) updates.pathway = payload.pathway;
        if (payload.project?.name !== undefined) updates.project_name = payload.project.name;
        if (payload.project?.description !== undefined) {
            updates.project_description = payload.project.description;
        }
        if (payload.project?.demo_url !== undefined) {
            updates.project_demo_url = payload.project.demo_url;
        }
        if (payload.project?.repo_url !== undefined) {
            updates.project_repo_url = payload.project.repo_url;
        }
        if (payload.project?.sourcing !== undefined) updates.sourcing = payload.project.sourcing;

        await updateTeamPartial(event, id, team.season_id, updates, {
            requireUnsubmitted: true,
        });

        return { message: "Updated your team & project" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
