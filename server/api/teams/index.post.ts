import { NethackPermissions } from "~~/shared/permissions";
import { CreateTeamRequest } from "~~/shared/schemas";
import { createTeam } from "~~/server/utils/database/teams";
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

        // Creation assigns the owner in the same transaction, so a team can
        // never be left without a member.
        const team = await createTeam(event, name, userID);

        return convertTeamToPublic(team, false, []);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
