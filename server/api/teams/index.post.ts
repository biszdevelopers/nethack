import { NethackPermissions } from "~~/shared/permissions";
import { CreateTeamRequest } from "~~/shared/schemas";
import { deleteTeams } from "~~/server/utils/database/teams";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Teams.create);
        const userID = user.id;
        if (user?.team_id && (await getTeam(event, user.team_id))) {
            throw createError({
                statusCode: 403,
                message: "Cannot create a team while in a team",
            });
        }

        const hackathon = await getHackathon(event);
        if (hackathon?.status !== "not_started" && hackathon?.status !== "in_progress") {
            throw createError({
                statusCode: 403,
                message: "Cannot create team after hackathon has finished",
            });
        }

        const { name } = await readValidatedBody(event, CreateTeamRequest.parse);

        const team = await createTeam(event, name);
        try {
            // Every team must have an owner; otherwise nobody can join it again.
            await addTeamMember(event, team.id, userID);
        } catch (error) {
            await deleteTeams(event, [team.id]);
            throw error;
        }

        return convertTeamToPublic(team, false, []);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
