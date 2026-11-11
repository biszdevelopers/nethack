import type { H3Event } from "h3";
import { eq, and, asc, isNull } from "drizzle-orm";
import { users, teams, userPastTeams } from "~~/server/database/schema";
import { changedRows } from "./query";

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
