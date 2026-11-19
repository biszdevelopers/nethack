import { NethackPermissions } from "~~/shared/permissions";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";
import { AddTeamMemberRequest, MAX_TEAM_MEMBERS, TeamIdParams } from "~~/shared/schemas";
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
                message: "Cannot invite members after the hackathon has finished",
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
                message: "Cannot invite members after the project is submitted",
            });
        }

        const target = await getUserByEmail(event, email);
        if (target) {
            if (target.id === currentUser.id) {
                throw createError({ status: 400, message: "You cannot invite yourself" });
            }
            if (target.is_admin || isInitialAdminEmail(target.email)) {
                throw createError({
                    status: 403,
                    message: "Staff accounts cannot join a participant team",
                });
            }
            if (target.team_id && (await getTeam(event, target.team_id))) {
                throw createError({
                    status: 409,
                    message: "That user is already in a team",
                });
            }
        }

        const [members, invites] = await Promise.all([
            getTeamMembers(event, teamID),
            getTeamInvites(event, teamID),
        ]);
        if (members.length + invites.length >= MAX_TEAM_MEMBERS) {
            throw createError({ status: 409, message: "This team is full" });
        }

        await createTeamInvite(event, teamID, email, currentUser.id);

        return { message: "Invitation sent" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
