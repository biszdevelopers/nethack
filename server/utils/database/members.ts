import type { H3Event } from "h3";
import { eq, and, asc, isNull, count } from "drizzle-orm";
import { users, teams, userPastTeams, teamInvites, seasons } from "~~/server/database/schema";
import { MAX_TEAM_MEMBERS } from "~~/shared/schemas";
import { changedRows, firstRow, lockForUpdateIfSupported } from "./query";

export async function getTeamMembers(event: H3Event, teamID: number): Promise<User[]> {
    return event.context.drizzle.select().from(users).where(eq(users.team_id, teamID));
}

export async function getAllTeamMembers(event: H3Event, teamID: number): Promise<User[]> {
    const current = await event.context.drizzle
        .select()
        .from(users)
        .where(eq(users.team_id, teamID))
        .orderBy(asc(users.id));

    const pastRows = await event.context.drizzle
        .select()
        .from(users)
        .innerJoin(userPastTeams, eq(users.id, userPastTeams.user_id))
        .where(eq(userPastTeams.team_id, teamID))
        .orderBy(asc(users.id));
    const past = pastRows.map((r: { users: User }) => ({ ...r.users }));

    const seen = new Map<number, User>();
    for (const user of current) {
        seen.set(user.id, user);
    }
    for (const user of past) {
        if (!seen.has(user.id)) {
            seen.set(user.id, user);
        }
    }

    return Array.from(seen.values()).sort((a, b) => a.id - b.id);
}

export async function getUserPastTeams(event: H3Event, userID: number): Promise<Team[]> {
    const rows = await event.context.drizzle
        .select()
        .from(teams)
        .innerJoin(userPastTeams, eq(teams.id, userPastTeams.team_id))
        .where(eq(userPastTeams.user_id, userID))
        .orderBy(asc(teams.id));
    return rows.map((r: { teams: Team }) => ({ ...r.teams }));
}

export async function addUserPastTeam(event: H3Event, userID: number, teamID: number) {
    await event.context.drizzle
        .insert(userPastTeams)
        .values({ user_id: userID, team_id: teamID })
        .onConflictDoNothing();
}

export async function removeTeamMember(event: H3Event, teamID: number, userID: number) {
    await event.context.drizzle.transaction(async (tx) => {
        // Serialize removals per team so two concurrent removals cannot both
        // observe the same count and leave the team with no members.
        await lockForUpdateIfSupported(
            tx.select().from(teams).where(eq(teams.id, teamID)).limit(1),
        );
        const [memberCount] = await tx
            .select({ value: count() })
            .from(users)
            .where(eq(users.team_id, teamID));
        const changed = await changedRows(
            tx
                .update(users)
                .set({ team_id: null })
                .where(and(eq(users.id, userID), eq(users.team_id, teamID)))
                .returning({ id: users.id }),
        );

        if (changed === 0) {
            throw createError({
                status: 404,
                message: "User not found or not in team",
            });
        }
        if (memberCount!.value <= 1) {
            throw createError({
                statusCode: 409,
                message: "Every team must keep at least one member",
            });
        }

        await tx
            .insert(userPastTeams)
            .values({ user_id: userID, team_id: teamID })
            .onConflictDoNothing();
    });
}

export async function addTeamMember(event: H3Event, teamID: number, userID: number) {
    const changed = await changedRows(
        event.context.drizzle
            .update(users)
            .set({ team_id: teamID })
            .where(and(eq(users.id, userID), isNull(users.team_id)))
            .returning({ id: users.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "User not found or already in a team",
        });
    }
}

export async function getTeamInvites(event: H3Event, teamID: number): Promise<TeamInvite[]> {
    return event.context.drizzle
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.team_id, teamID))
        .orderBy(asc(teamInvites.id));
}

export async function getInvitesForEmail(
    event: H3Event,
    email: string,
): Promise<Array<Pick<TeamInvite, "id" | "team_id"> & { team_name: string }>> {
    return event.context.drizzle
        .select({
            id: teamInvites.id,
            team_id: teamInvites.team_id,
            team_name: teams.name,
        })
        .from(teamInvites)
        .innerJoin(teams, eq(teamInvites.team_id, teams.id))
        .innerJoin(seasons, eq(teams.season_id, seasons.id))
        .where(and(eq(teamInvites.email, email.trim().toLowerCase()), eq(seasons.is_active, 1)))
        .orderBy(asc(teamInvites.id));
}

export async function createTeamInvite(
    event: H3Event,
    teamID: number,
    email: string,
    invitedBy: number,
) {
    const created = await event.context.drizzle
        .insert(teamInvites)
        .values({
            team_id: teamID,
            email: email.trim().toLowerCase(),
            invited_by: invitedBy,
            created_at: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: teamInvites.id });

    if (created.length === 0) {
        throw createError({
            statusCode: 409,
            message: "That email already has an invitation for this team",
        });
    }
}

export async function deleteTeamInvite(event: H3Event, teamID: number, inviteID: number) {
    const changed = await changedRows(
        event.context.drizzle
            .delete(teamInvites)
            .where(and(eq(teamInvites.id, inviteID), eq(teamInvites.team_id, teamID)))
            .returning({ id: teamInvites.id }),
    );

    if (changed === 0) {
        throw createError({ statusCode: 404, message: "Invitation not found" });
    }
}

/** Accept an invitation: the email must match, the team must be current, and it must not be full. */
export async function acceptTeamInvite(
    event: H3Event,
    inviteID: number,
    user: User,
): Promise<Team> {
    return event.context.drizzle.transaction(async (tx) => {
        const invite = await firstRow(
            tx.select().from(teamInvites).where(eq(teamInvites.id, inviteID)).limit(1),
        );
        if (!invite || invite.email !== user.email.trim().toLowerCase()) {
            throw createError({ statusCode: 404, message: "Invitation not found" });
        }

        // Lock the invited team (so concurrent accepts cannot bypass the member
        // cap) and the accepting user (so two invites cannot be accepted at
        // once). Locks are always taken in this order to avoid deadlocks.
        await lockForUpdateIfSupported(
            tx.select().from(teams).where(eq(teams.id, invite.team_id)).limit(1),
        );
        const lockedUser = await firstRow(
            lockForUpdateIfSupported(tx.select().from(users).where(eq(users.id, user.id)).limit(1)),
        );

        const team = await firstRow(
            tx.select().from(teams).where(eq(teams.id, invite.team_id)).limit(1),
        );
        if (!team) {
            throw createError({ statusCode: 404, message: "Invitation not found" });
        }

        const activeSeason = await firstRow(
            tx.select().from(seasons).where(eq(seasons.is_active, 1)).limit(1),
        );
        if (!activeSeason || team.season_id !== activeSeason.id) {
            throw createError({
                statusCode: 409,
                message: "This invitation is for a season that has ended",
            });
        }
        if (team.project_submitted) {
            throw createError({
                statusCode: 409,
                message: "This team has already submitted its project",
            });
        }

        if (lockedUser?.team_id) {
            const currentTeam = await firstRow(
                tx
                    .select()
                    .from(teams)
                    .where(
                        and(eq(teams.id, lockedUser.team_id), eq(teams.season_id, activeSeason.id)),
                    )
                    .limit(1),
            );
            if (currentTeam) {
                throw createError({
                    statusCode: 409,
                    message: "You are already in a team",
                });
            }
        }

        const members = await tx.select().from(users).where(eq(users.team_id, team.id));
        if (members.length >= MAX_TEAM_MEMBERS) {
            throw createError({ statusCode: 409, message: "This team is full" });
        }

        await tx.update(users).set({ team_id: team.id }).where(eq(users.id, user.id));
        await tx.delete(teamInvites).where(eq(teamInvites.email, invite.email));

        return team as Team;
    });
}

export async function declineTeamInvite(event: H3Event, inviteID: number, email: string) {
    const changed = await changedRows(
        event.context.drizzle
            .delete(teamInvites)
            .where(
                and(
                    eq(teamInvites.id, inviteID),
                    eq(teamInvites.email, email.trim().toLowerCase()),
                ),
            )
            .returning({ id: teamInvites.id }),
    );

    if (changed === 0) {
        throw createError({ statusCode: 404, message: "Invitation not found" });
    }
}
