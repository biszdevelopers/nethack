import type { H3Event } from "h3";
import { eq, and, inArray, notExists } from "drizzle-orm";
import {
    teams,
    teamScores,
    ballotScores,
    teamAwards,
    userPastTeams,
    users,
} from "~~/server/database/schema";
import { changedRows, firstRow } from "./query";

// --- Active season filtered (default behavior) ---
/**
 * Gets the team by ID only in the active season.
 * For wildcard searches use getTeamById, or set
 * allSeason to true
 *
 */
export async function getTeam(
    event: H3Event,
    teamID: number,
    allSeason?: boolean,
): Promise<Team | null> {
    if (allSeason) {
        const row = await firstRow(
            event.context.drizzle.select().from(teams).where(eq(teams.id, teamID)).limit(1),
        );
        return row ?? null;
    }
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id ?? -1;
    const row = await firstRow(
        event.context.drizzle
            .select()
            .from(teams)
            .where(and(eq(teams.id, teamID), eq(teams.season_id, seasonId)))
            .limit(1),
    );
    return row ?? null;
}

export async function getAllTeams(event: H3Event): Promise<Team[]> {
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id ?? -1;
    return event.context.drizzle
        .select()
        .from(teams)
        .where(eq(teams.season_id, seasonId))
        .then((rows) => rows as Team[]);
}

export async function getSubmittedUnjudgedTeams(
    event: H3Event,
    judgeUserID: number,
): Promise<Team[]> {
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id ?? -1;

    const subquery = event.context.drizzle
        .select({ team_id: teamScores.team_id })
        .from(teamScores)
        .where(and(eq(teamScores.judge_user_id, judgeUserID), eq(teamScores.team_id, teams.id)));

    return event.context.drizzle
        .select()
        .from(teams)
        .where(
            and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1), notExists(subquery)),
        )
        .then((rows) => rows as Team[]);
}

export async function getSubmittedTeams(event: H3Event): Promise<Team[]> {
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id ?? -1;
    return event.context.drizzle
        .select()
        .from(teams)
        .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1)))
        .then((rows) => rows as Team[]);
}

// --- Unrestricted / by season ---
/**
 * Get a team by its ID. Not limited to the active season.
 * Essentially the same as `getTeam(event, teamID, true)`
 */
export async function getTeamById(event: H3Event, teamID: number): Promise<Team | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(teams).where(eq(teams.id, teamID)).limit(1),
    );
    return row ?? null;
}

export async function getTeamBySeason(
    event: H3Event,
    teamID: number,
    seasonId: number,
): Promise<Team | null> {
    const row = await firstRow(
        event.context.drizzle
            .select()
            .from(teams)
            .where(and(eq(teams.id, teamID), eq(teams.season_id, seasonId)))
            .limit(1),
    );

    return row ?? null;
}

export async function getAllTeamsAllSeasons(event: H3Event): Promise<Team[]> {
    return (await event.context.drizzle.select().from(teams)) as Team[];
}

export async function getTeamsBySeason(event: H3Event, seasonId: number): Promise<Team[]> {
    return event.context.drizzle
        .select()
        .from(teams)
        .where(eq(teams.season_id, seasonId))
        .then((rows) => rows as Team[]);
}

// --- Mutations ---

export async function createTeam(event: H3Event, teamName: string): Promise<Team> {
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id;
    if (!seasonId) {
        throw createError({
            status: 403,
            message: "No active season",
        });
    }

    const team = (await firstRow(
        event.context.drizzle
            .insert(teams)
            .values({ name: teamName, season_id: seasonId })
            .returning(),
    )) as Team;

    return team;
}

export async function updateTeam(event: H3Event, team: Team) {
    const changed = await changedRows(
        event.context.drizzle
            .update(teams)
            .set({
                name: team.name,
                pathway: team.pathway,
                score: team.score,
                rank: team.rank,
                project_name: team.project_name,
                project_description: team.project_description,
                project_demo_url: team.project_demo_url,
                project_repo_url: team.project_repo_url,
                project_submitted: team.project_submitted,
                sourcing: team.sourcing,
                season_id: team.season_id,
            })
            .where(eq(teams.id, team.id))
            .returning({ id: teams.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "Team not found",
        });
    }
}

export async function deleteTeams(event: H3Event, teamIDs: number[]) {
    if (teamIDs.length === 0) return;

    await event.context.drizzle.transaction(async (tx) => {
        await tx.delete(ballotScores).where(inArray(ballotScores.project_id, teamIDs));
        await tx.delete(teamScores).where(inArray(teamScores.team_id, teamIDs));
        await tx.delete(teamAwards).where(inArray(teamAwards.team_id, teamIDs));
        await tx.delete(userPastTeams).where(inArray(userPastTeams.team_id, teamIDs));
        await tx.update(users).set({ team_id: null }).where(inArray(users.team_id, teamIDs));
        await tx.delete(teams).where(inArray(teams.id, teamIDs));
    });
}
