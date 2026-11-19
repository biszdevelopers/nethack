import type { H3Event } from "h3";
import { eq, and, inArray, notExists, asc, sql, ne } from "drizzle-orm";
import {
    teams,
    teamScores,
    ballotScores,
    teamAwards,
    userPastTeams,
    users,
    seasons,
} from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { changedRows, firstRow, lockForUpdateIfSupported } from "./query";

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
    judgeTeamId: number | null = null,
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
            and(
                eq(teams.season_id, seasonId),
                eq(teams.project_submitted, 1),
                ne(teams.id, judgeTeamId ?? -1),
                notExists(subquery),
            ),
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
        .orderBy(asc(teams.id))
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

/** Public listing: only submitted projects, in a stable order. */
export async function getPublicTeams(event: H3Event, seasonId?: number): Promise<Team[]> {
    // Default to the active season; an unfiltered listing must never mix
    // projects from historical seasons.
    const targetSeasonId = seasonId ?? (await getActiveSeason(event))?.id ?? -1;
    return event.context.drizzle
        .select()
        .from(teams)
        .where(and(eq(teams.season_id, targetSeasonId), eq(teams.project_submitted, 1)))
        .orderBy(asc(teams.id))
        .then((rows) => rows as Team[]);
}

// --- Mutations ---

/** Reject a season that a concurrent switch deactivated while the lock waited. */
export function assertSeasonStillActive(season: { is_active: number } | undefined): void {
    if (!season || season.is_active !== 1) {
        throw createError({
            statusCode: 409,
            message: "No active season",
        });
    }
}

export async function createTeam(event: H3Event, teamName: string): Promise<Team> {
    const activeSeason = await getActiveSeason(event);
    const seasonId = activeSeason?.id;
    if (!seasonId) {
        throw createError({
            status: 403,
            message: "No active season",
        });
    }

    return event.context.drizzle.transaction(async (tx) => {
        // Serialize creations for the season so the name check and the insert
        // cannot both pass for two concurrent requests. Re-read the locked row:
        // a concurrent season switch may have deactivated it while we waited.
        const [lockedSeason] = await lockForUpdateIfSupported(
            tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
        );
        assertSeasonStillActive(lockedSeason);

        const duplicate = await firstRow(
            tx
                .select({ id: teams.id })
                .from(teams)
                .where(
                    and(
                        eq(teams.season_id, seasonId),
                        eq(sql`lower(${teams.name})`, teamName.trim().toLowerCase()),
                    ),
                )
                .limit(1),
        );
        if (duplicate) {
            throw createError({
                statusCode: 409,
                message: "A team with that name already exists in this season",
            });
        }

        return (await firstRow(
            tx.insert(teams).values({ name: teamName, season_id: seasonId }).returning(),
        )) as Team;
    });
}

export async function updateTeam(
    event: H3Event,
    team: Team,
    options: { requireUnsubmitted?: boolean } = {},
) {
    const where = options.requireUnsubmitted
        ? and(eq(teams.id, team.id), eq(teams.project_submitted, 0))
        : eq(teams.id, team.id);
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
            .where(where)
            .returning({ id: teams.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "Team not found",
        });
    }
}

/**
 * Update only the supplied columns so two members editing different fields do
 * not clobber each other. Renames still enforce the per-season name rule.
 */
export async function updateTeamPartial(
    event: H3Event,
    teamID: number,
    seasonID: number,
    updates: Partial<typeof teams.$inferInsert>,
    options: { requireUnsubmitted?: boolean } = {},
) {
    if (Object.keys(updates).length === 0) return;

    if (updates.name !== undefined) {
        const duplicate = await firstRow(
            event.context.drizzle
                .select({ id: teams.id })
                .from(teams)
                .where(
                    and(
                        eq(teams.season_id, seasonID),
                        ne(teams.id, teamID),
                        eq(sql`lower(${teams.name})`, updates.name.trim().toLowerCase()),
                    ),
                )
                .limit(1),
        );
        if (duplicate) {
            throw createError({
                statusCode: 409,
                message: "A team with that name already exists in this season",
            });
        }
    }

    const where = options.requireUnsubmitted
        ? and(eq(teams.id, teamID), eq(teams.project_submitted, 0))
        : eq(teams.id, teamID);
    const changed = await changedRows(
        event.context.drizzle.update(teams).set(updates).where(where).returning({ id: teams.id }),
    );

    if (changed === 0) {
        throw createError({
            statusCode: 404,
            message: "Team not found",
        });
    }
}

export async function deleteTeamsInTransaction(
    tx: Pick<DrizzleDatabase, "delete" | "update">,
    teamIDs: number[],
) {
    if (teamIDs.length === 0) return;

    await tx.delete(ballotScores).where(inArray(ballotScores.project_id, teamIDs));
    await tx.delete(teamScores).where(inArray(teamScores.team_id, teamIDs));
    await tx.delete(teamAwards).where(inArray(teamAwards.team_id, teamIDs));
    await tx.delete(userPastTeams).where(inArray(userPastTeams.team_id, teamIDs));
    await tx.update(users).set({ team_id: null }).where(inArray(users.team_id, teamIDs));
    await tx.delete(teams).where(inArray(teams.id, teamIDs));
}

export async function deleteTeams(event: H3Event, teamIDs: number[]) {
    if (teamIDs.length === 0) return;
    await event.context.drizzle.transaction((tx) => deleteTeamsInTransaction(tx, teamIDs));
}
