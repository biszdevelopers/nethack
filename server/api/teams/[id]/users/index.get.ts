import { getTeamById } from "~~/server/utils/database/teams";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import {
    getAllTeamMembers,
    getTeamMembers,
    getUserPastTeams,
} from "~~/server/utils/database/members";
import { NethackPermissions } from "~~/shared/permissions";
import { TeamIdParams } from "~~/shared/schemas";

export default defineEventHandler(async (event) => {
    const { id: teamID } = await getValidatedRouterParams(event, TeamIdParams.parse);
    const requester = await requireUser(event);

    const team = await getTeamById(event, teamID);
    if (!team) throw createError({ statusCode: 404, message: "Team not found" });

    const requesterPastTeams = await getUserPastTeams(event, requester.id);
    const isMember =
        requester.team_id === teamID ||
        requesterPastTeams.some((pastTeam) => pastTeam.id === teamID);
    if (!isMember) await requireUser(event, NethackPermissions.all);

    const activeSeason = await getActiveSeason(event);
    const isOldTeam = activeSeason && team.season_id !== activeSeason.id;

    const members = isOldTeam
        ? await getAllTeamMembers(event, teamID)
        : await getTeamMembers(event, teamID);

    return members.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        team_id: user.team_id,
    })) satisfies GetTeamMembersResponse;
});
