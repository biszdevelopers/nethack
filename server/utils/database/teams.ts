import type { H3Event } from "h3";
import { eq, and, inArray, notExists, asc, sql, ne, type SQL } from "drizzle-orm";
import {
    teams,
    teamScores,
    ballotScores,
    teamAwards,
    teamInvites,
    userPastTeams,
    users,
    seasons,
} from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { changedRows, firstRow, lockForUpdateIfSupported } from "./query";
import { getActiveSeason } from "./seasons";
import { writeAuditEvent } from "~~/server/utils/audit";

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
    extraWhere?: SQL,
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
                eq(teams.status, "active"),
                ne(teams.id, judgeTeamId ?? -1),
                notExists(subquery),
                extraWhere,
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
        .where(
            and(
                eq(teams.season_id, targetSeasonId),
                eq(teams.project_submitted, 1),
                eq(teams.status, "active"),
            ),
        )
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

/**
 * Create a team and assign its owner in one transaction. A team must never
 * exist without a member, even if the process stops mid-request.
 */
export async function createTeam(
    event: H3Event,
    teamName: string,
    ownerUserID: number,
): Promise<Team> {
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

        const [owner] = await lockForUpdateIfSupported(
            tx
                .select({ id: users.id, team_id: users.team_id, is_judge: users.is_judge })
                .from(users)
                .where(eq(users.id, ownerUserID))
                .limit(1),
        );
        if (!owner) {
            throw createError({ statusCode: 401, message: "Logged in user not found" });
        }
        if (owner.team_id !== null) {
            const currentTeam = await firstRow(
                tx
                    .select({ id: teams.id })
                    .from(teams)
                    .where(and(eq(teams.id, owner.team_id), eq(teams.season_id, seasonId)))
                    .limit(1),
            );
            if (currentTeam) {
                throw createError({
                    statusCode: 403,
                    message: "Cannot create a team while in a team",
                });
            }
        }

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

        const team = (await firstRow(
            tx
                .insert(teams)
                .values({ name: teamName, season_id: seasonId, owner_user_id: ownerUserID })
                .returning(),
        )) as Team;
        await tx
            .update(users)
            .set({ team_id: team.id, ...(owner.is_judge ? { is_judge: 0 } : {}) })
            .where(eq(users.id, ownerUserID));
        if (owner.is_judge) {
            // A competitor cannot be a judge; drop the local grant when the
            // account joins a team. An administrator can re-promote later.
            await writeAuditEvent(tx, event, {
                action: "user.judge",
                entity_type: "user",
                entity_id: ownerUserID,
                before: { is_judge: true },
                after: { is_judge: false },
                reason: "Joined a competing team",
            });
        }
        if (owner.team_id !== null) {
            await tx
                .insert(userPastTeams)
                .values({ user_id: ownerUserID, team_id: owner.team_id })
                .onConflictDoNothing();
        }
        return team;
    });
}

/**
 * Explain a guarded team update that matched no row. A repeated submission or
 * a concurrent withdrawal is a conflict, not a missing team.
 */
async function teamUpdateFailure(
    db: Pick<DrizzleDatabase, "select">,
    teamID: number,
    options: { requireUnsubmitted?: boolean; requireActive?: boolean },
) {
    const current = await firstRow(db.select().from(teams).where(eq(teams.id, teamID)).limit(1));
    if (!current) return createError({ statusCode: 404, message: "Team not found" });
    if (options.requireUnsubmitted && current.project_submitted) {
        return createError({ statusCode: 409, message: "Project is already submitted" });
    }
    return createError({ statusCode: 409, message: "This team is no longer competing" });
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
    options: { requireUnsubmitted?: boolean; requireActive?: boolean } = {},
) {
    if (Object.keys(updates).length === 0) return;

    const where = and(
        eq(teams.id, teamID),
        options.requireUnsubmitted ? eq(teams.project_submitted, 0) : undefined,
        options.requireActive ? eq(teams.status, "active") : undefined,
    );

    if (updates.name === undefined) {
        // A single statement is already atomic; no season-wide lock is needed
        // for ordinary autosaves, which would otherwise serialize every team.
        const changed = await changedRows(
            event.context.drizzle
                .update(teams)
                .set(updates)
                .where(where)
                .returning({ id: teams.id }),
        );
        if (changed === 0) {
            throw await teamUpdateFailure(event.context.drizzle, teamID, options);
        }
        return;
    }

    // Serialize renames with team creation on the season row, so two
    // concurrent renames cannot both pass the duplicate-name check.
    await event.context.drizzle.transaction(async (tx) => {
        await lockForUpdateIfSupported(
            tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, seasonID)).limit(1),
        );

        const duplicate = await firstRow(
            tx
                .select({ id: teams.id })
                .from(teams)
                .where(
                    and(
                        eq(teams.season_id, seasonID),
                        ne(teams.id, teamID),
                        eq(sql`lower(${teams.name})`, updates.name!.trim().toLowerCase()),
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

        const changed = await changedRows(
            tx.update(teams).set(updates).where(where).returning({ id: teams.id }),
        );

        if (changed === 0) {
            throw await teamUpdateFailure(tx, teamID, options);
        }
    });
}

/** The owner account controls roster changes; administrators can do anything. */
export function canManageTeam(
    team: Pick<Team, "owner_user_id">,
    user: Pick<User, "id" | "is_admin">,
): boolean {
    if (user.is_admin === 1) return true;
    // Teams created before ownership tracking have no owner; any current member
    // (verified by the caller) keeps the historical roster capability.
    if (team.owner_user_id === null) return true;
    return team.owner_user_id === user.id;
}

/**
 * Withdraw a team before it is judged. The row is archived with its roster
 * history so past-season views keep showing the team; a re-clone of the same
 * name remains impossible until an administrator renames it.
 */
export async function disbandTeam(event: H3Event, teamID: number): Promise<void> {
    await event.context.drizzle.transaction(async (tx) => {
        const [team] = await lockForUpdateIfSupported(
            tx.select().from(teams).where(eq(teams.id, teamID)).limit(1),
        );
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        if (team.project_submitted) {
            throw createError({
                statusCode: 409,
                message: "Cannot disband a team after its project is submitted",
            });
        }
        const judged = await firstRow(
            tx
                .select({ team_id: teamScores.team_id })
                .from(teamScores)
                .where(eq(teamScores.team_id, teamID))
                .limit(1),
        );
        if (judged) {
            throw createError({
                statusCode: 409,
                message: "Cannot disband a team that already has judge scores",
            });
        }

        const members = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.team_id, teamID));
        for (const member of members) {
            await tx
                .insert(userPastTeams)
                .values({ user_id: member.id, team_id: teamID })
                .onConflictDoNothing();
        }
        await tx.update(users).set({ team_id: null }).where(eq(users.team_id, teamID));
        await tx.delete(teamInvites).where(eq(teamInvites.team_id, teamID));
        await tx.update(teams).set({ status: "withdrawn" }).where(eq(teams.id, teamID));
        await writeAuditEvent(tx, event, {
            action: "team.disband",
            entity_type: "team",
            entity_id: teamID,
            before: { name: team.name, status: team.status, members: members.length },
            after: { status: "withdrawn" },
        });
    });
}

/** Hand the roster controls to another current member. */
export async function transferTeamOwnership(
    event: H3Event,
    teamID: number,
    newOwnerUserID: number,
): Promise<void> {
    await event.context.drizzle.transaction(async (tx) => {
        const [team] = await lockForUpdateIfSupported(
            tx.select().from(teams).where(eq(teams.id, teamID)).limit(1),
        );
        if (!team) {
            throw createError({ statusCode: 404, message: "Team not found" });
        }
        if (team.owner_user_id === newOwnerUserID) {
            throw createError({ statusCode: 409, message: "That member already owns this team" });
        }
        const target = await firstRow(
            tx
                .select({ id: users.id })
                .from(users)
                .where(and(eq(users.id, newOwnerUserID), eq(users.team_id, teamID)))
                .limit(1),
        );
        if (!target) {
            throw createError({
                statusCode: 404,
                message: "That user is not a current member of this team",
            });
        }
        await tx.update(teams).set({ owner_user_id: newOwnerUserID }).where(eq(teams.id, teamID));
        await writeAuditEvent(tx, event, {
            action: "team.transfer_owner",
            entity_type: "team",
            entity_id: teamID,
            before: { owner_user_id: team.owner_user_id },
            after: { owner_user_id: newOwnerUserID },
        });
    });
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
