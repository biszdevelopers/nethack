import { NethackPermissions } from "~~/shared/permissions";
import { CreateTeamRequest } from "~~/shared/schemas";
import { createTeam } from "~~/server/utils/database/teams";
import { getEventState } from "~~/server/utils/event-state";
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

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                statusCode: 403,
                message: state.paused
                    ? "The event is paused"
                    : "Cannot create team after submissions close",
            });
        }

        const { name } = await readValidatedBody(event, CreateTeamRequest.parse);

        // Creation assigns the owner in the same transaction, so a team can
        // never be left without a member.
        const team = await createTeam(event, name, userID);

        return convertTeamToPublic(team, false, []);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
