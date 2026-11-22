import { NethackPermissions } from "~~/shared/permissions";
import { AddTeamMemberRequest, TeamIdParams } from "~~/shared/schemas";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";
import { createTeamInvite } from "~~/server/utils/database/members";
import { getUserByEmail } from "~~/server/utils/database/users";
import { canManageTeam, getTeam } from "~~/server/utils/database/teams";
import { getEventState } from "~~/server/utils/event-state";
import { notifyUserByEmail } from "~~/server/utils/notifications";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);

        const currentUser = await requireUser(event, NethackPermissions.Teams.membersAddOwn);
        const team = await getTeam(event, teamID);
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        const currentTeam = currentUser.team_id ? await getTeam(event, currentUser.team_id) : null;
        if (currentTeam?.id !== teamID) {
            throw createError({
                status: 403,
                message: "Cannot add members to other teams",
            });
        }
        if (!canManageTeam(team, currentUser)) {
            throw createError({
                status: 403,
                message: "Only the team owner can invite members",
            });
        }

        const state = await getEventState(event);
        if (!state.submissionsOpen) {
            throw createError({
                status: 403,
                message: state.paused
                    ? "The event is paused"
                    : state.hackathon?.status === "finished" || state.hackathon?.status === "voting"
                      ? "Cannot invite members after the hackathon has finished"
                      : "Cannot invite members after submissions close",
            });
        }

        const { email, allowUnclaimed } = await readValidatedBody(
            event,
            AddTeamMemberRequest.parse,
        );

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
        } else if (allowUnclaimed !== true) {
            throw createError({
                statusCode: 400,
                message:
                    "No account exists for that email yet. Confirm the address, or allow an unclaimed invitation.",
            });
        }

        const invite = await createTeamInvite(event, teamID, email, currentUser.id);
        await notifyUserByEmail(event, {
            email,
            type: "team_invite",
            title: `Invitation to join ${team.name}`,
            body: `${currentUser.name ?? "A participant"} invited you to join ${team.name}.`,
            link: "/dashboard",
        });

        return {
            id: invite.id,
            email: email.trim().toLowerCase(),
            token: invite.token,
            expires_at: invite.expires_at.toISOString(),
            invite_url: `/dashboard/teams?invite=${invite.token}`,
            message: "Invitation sent",
        } satisfies CreateTeamInviteResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
