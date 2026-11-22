import type { H3Event } from "h3";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, or, asc, gt, isNull, lte, count, sql } from "drizzle-orm";
import { users, teams, userPastTeams, teamInvites, seasons } from "~~/server/database/schema";
import { MAX_TEAM_MEMBERS } from "~~/shared/schemas";
import { changedRows, firstRow, lockForUpdateIfSupported } from "./query";
import { getActiveSeason } from "./seasons";
import { writeAuditEvent } from "~~/server/utils/audit";

const DEFAULT_INVITE_TTL_DAYS = 7;

/** Invitation lifetime in days; bounded so a typo cannot mint permanent links. */
function getTeamInviteTtlDays(): number {
    const raw = Number(process.env.TEAM_INVITE_TTL_DAYS?.trim());
    return Number.isFinite(raw) && raw > 0 && raw <= 365
        ? Math.floor(raw)
        : DEFAULT_INVITE_TTL_DAYS;
}

function hashInviteToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Capacity for the active season, falling back to the historical constant. */
export async function getTeamMemberLimit(event: H3Event): Promise<number> {
    const season = await getActiveSeason(event);
    const limit = season?.max_team_members;
    return typeof limit === "number" && limit >= 1 ? limit : MAX_TEAM_MEMBERS;
}

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

    // A pointer to a team from an ended season is history even when the
    // rollover never wrote a user_past_teams row for it.
    const archivedPointerRows = await event.context.drizzle
        .select()
        .from(teams)
        .innerJoin(users, eq(users.team_id, teams.id))
        .innerJoin(seasons, eq(seasons.id, teams.season_id))
        .where(and(eq(users.id, userID), eq(seasons.is_active, 0)))
        .orderBy(asc(teams.id));

    const seen = new Map<number, Team>();
    for (const row of rows) seen.set(row.teams.id, row.teams as Team);
    for (const row of archivedPointerRows) seen.set(row.teams.id, row.teams as Team);
    return [...seen.values()].sort((a, b) => a.id - b.id);
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
        const [team] = await lockForUpdateIfSupported(
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

        // A departing owner must not leave the roster without a manager: the
        // owner pointer would name a non-member, and no remaining member could
        // invite, remove, or transfer the team.
        if (team?.owner_user_id === userID) {
            // The earliest remaining member takes over. The roster-count guard
            // above guarantees at least one member remains.
            await tx
                .update(teams)
                .set({
                    owner_user_id: sql<
                        number | null
                    >`(SELECT MIN(id) FROM users WHERE team_id = ${teamID})`,
                })
                .where(eq(teams.id, teamID));
        }
    });
}

export async function addTeamMember(event: H3Event, teamID: number, userID: number) {
    const target = await firstRow(
        event.context.drizzle
            .select({ season_id: teams.season_id })
            .from(teams)
            .where(eq(teams.id, teamID))
            .limit(1),
    );
    if (!target) {
        throw createError({ statusCode: 404, message: "User not found or already in a team" });
    }
    const previous = await firstRow(
        event.context.drizzle
            .select({ team_id: users.team_id })
            .from(users)
            .where(eq(users.id, userID))
            .limit(1),
    );
    // A team_id left over from an earlier season must not block joining the
    // active season's team, but a current-season membership still must.
    const changed = await changedRows(
        event.context.drizzle
            .update(users)
            .set({ team_id: teamID })
            .where(
                and(
                    eq(users.id, userID),
                    or(
                        isNull(users.team_id),
                        sql`${users.team_id} IN (SELECT id FROM teams WHERE season_id <> ${target.season_id})`,
                    ),
                ),
            )
            .returning({ id: users.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "User not found or already in a team",
        });
    }
    if (previous?.team_id && previous.team_id !== teamID) {
        await addUserPastTeam(event, userID, previous.team_id);
    }
}

const pendingInviteFilter = () =>
    or(isNull(teamInvites.expires_at), gt(teamInvites.expires_at, new Date()));

export async function getTeamInvites(
    event: H3Event,
    teamID: number,
): Promise<Array<Omit<TeamInvite, "token">>> {
    return event.context.drizzle
        .select({
            id: teamInvites.id,
            team_id: teamInvites.team_id,
            email: teamInvites.email,
            invited_by: teamInvites.invited_by,
            expires_at: teamInvites.expires_at,
            created_at: teamInvites.created_at,
        })
        .from(teamInvites)
        .where(and(eq(teamInvites.team_id, teamID), pendingInviteFilter()))
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
        .where(
            and(
                eq(teamInvites.email, email.trim().toLowerCase()),
                eq(seasons.is_active, 1),
                pendingInviteFilter(),
            ),
        )
        .orderBy(asc(teamInvites.id));
}

/**
 * Create a pending invitation and return the raw bearer token exactly once.
 * Only its SHA-256 digest is persisted, so a database export cannot be used to
 * redeem outstanding invitations. Capacity is re-checked under the team lock so
 * concurrent invites cannot push a roster past the season limit.
 */
export async function createTeamInvite(
    event: H3Event,
    teamID: number,
    email: string,
    invitedBy: number,
): Promise<{ id: number; token: string; expires_at: Date }> {
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date();
    return event.context.drizzle.transaction(async (tx) => {
        await lockForUpdateIfSupported(
            tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamID)).limit(1),
        );
        const season = await firstRow(
            tx.select().from(seasons).where(eq(seasons.is_active, 1)).limit(1),
        );
        const limit =
            typeof season?.max_team_members === "number" && season.max_team_members >= 1
                ? season.max_team_members
                : MAX_TEAM_MEMBERS;
        const [memberCount] = await tx
            .select({ value: count() })
            .from(users)
            .where(eq(users.team_id, teamID));
        const [inviteCount] = await tx
            .select({ value: count() })
            .from(teamInvites)
            .where(and(eq(teamInvites.team_id, teamID), pendingInviteFilter()));
        if (Number(memberCount!.value) + Number(inviteCount!.value) >= limit) {
            throw createError({ statusCode: 409, message: "This team is full" });
        }

        // Expired rows no longer block a fresh invitation for the same address.
        await tx
            .delete(teamInvites)
            .where(and(eq(teamInvites.email, normalizedEmail), lte(teamInvites.expires_at, now)));

        const rawToken = randomBytes(32).toString("hex");
        const expires_at = new Date(now.getTime() + getTeamInviteTtlDays() * 86_400_000);
        const created = await tx
            .insert(teamInvites)
            .values({
                team_id: teamID,
                email: normalizedEmail,
                invited_by: invitedBy,
                token: hashInviteToken(rawToken),
                expires_at,
                created_at: now,
            })
            .onConflictDoNothing()
            .returning({ id: teamInvites.id });

        if (created.length === 0) {
            throw createError({
                statusCode: 409,
                message: "That email already has an invitation for this team",
            });
        }
        return { id: created[0]!.id, token: rawToken, expires_at };
    });
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

/** Accept an invitation by its row id or its raw bearer token. */
export async function acceptTeamInvite(
    event: H3Event,
    inviteID: number,
    user: User,
): Promise<Team> {
    return acceptInviteWithSelector(event, { id: inviteID }, user);
}

export async function acceptTeamInviteByToken(
    event: H3Event,
    token: string,
    user: User,
): Promise<Team> {
    return acceptInviteWithSelector(event, { token: hashInviteToken(token) }, user);
}

async function acceptInviteWithSelector(
    event: H3Event,
    selector: { id: number } | { token: string },
    user: User,
): Promise<Team> {
    return event.context.drizzle.transaction(async (tx) => {
        const invite = await firstRow(
            tx
                .select()
                .from(teamInvites)
                .where(
                    "id" in selector
                        ? eq(teamInvites.id, selector.id)
                        : eq(teamInvites.token, selector.token),
                )
                .limit(1),
        );
        if (!invite || invite.email !== user.email.trim().toLowerCase()) {
            throw createError({ statusCode: 404, message: "Invitation not found" });
        }
        if (invite.expires_at) {
            const expiresAtMs = new Date(invite.expires_at as unknown as string | number).getTime();
            if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
                throw createError({ statusCode: 410, message: "This invitation has expired" });
            }
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
        if (!lockedUser) {
            throw createError({ statusCode: 404, message: "Invitation not found" });
        }

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
        if (team.status !== "active") {
            throw createError({
                statusCode: 409,
                message: "This team is no longer accepting members",
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
            if (currentTeam && currentTeam.status === "active") {
                throw createError({
                    statusCode: 409,
                    message: "You are already in a team",
                });
            }
        }

        const members = await tx.select().from(users).where(eq(users.team_id, team.id));
        if (members.length >= activeSeason.max_team_members) {
            throw createError({ statusCode: 409, message: "This team is full" });
        }

        if (lockedUser?.team_id) {
            await tx
                .insert(userPastTeams)
                .values({ user_id: user.id, team_id: lockedUser.team_id })
                .onConflictDoNothing();
        }
        await tx
            .update(users)
            .set({ team_id: team.id, ...(lockedUser.is_judge ? { is_judge: 0 } : {}) })
            .where(eq(users.id, user.id));
        if (lockedUser.is_judge) {
            await writeAuditEvent(tx, event, {
                action: "user.judge",
                entity_type: "user",
                entity_id: user.id,
                before: { is_judge: true },
                after: { is_judge: false },
                reason: "Joined a competing team",
            });
        }
        // Accepting the invitation clears only this team's pending invitations
        // for the account. Invitations from other teams are left untouched.
        await tx
            .delete(teamInvites)
            .where(
                and(eq(teamInvites.team_id, invite.team_id), eq(teamInvites.email, invite.email)),
            );

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
