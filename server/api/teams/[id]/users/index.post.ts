import { NethackPermissions } from "~~/shared/permissions";
import { AddTeamMemberRequest, TeamIdParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        if (currentUser?.team_id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot add members to other teams",
            });
        }

        const hackathon = await getHackathon(event);
        if (hackathon?.status !== "not_started" && hackathon?.status !== "in_progress") {
            throw createError({
                status: 403,
                message: "Cannot add members after hackathon has finished",
            });
        }

        const { email } = await readValidatedBody(event, AddTeamMemberRequest.parse);

        const team = await getTeam(event, teamID);
        if (!team) {
            throw createError({ status: 404, message: "Team not found" });
        }
        if (team.project_submitted) {
            throw createError({
                status: 403,
                message: "Cannot add members after project is submitted",
            });
        }

        const user = await getUserByEmail(event, email);
        if (!user) {
            throw createError({
                status: 404,
                message: "User not found",
            });
        }

        await addTeamMember(event, teamID, user.id);

        return { message: "Added user to the team" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
