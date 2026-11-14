import type { H3Event } from "h3";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
    users,
    teamScores,
    ballots,
    ballotScores,
    userPastTeams,
    peerVotingScores,
    oauth2Applications,
} from "~~/server/database/schema";
import { changedRows, firstRow } from "./query";

export async function getUser(event: H3Event, userID: number): Promise<User | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(users).where(eq(users.id, userID)).limit(1),
    );

    return row ?? null;
}

export async function getUserByEmail(event: H3Event, email: string): Promise<User | null> {
    const row = await firstRow(
        event.context.drizzle
            .select()
            .from(users)
            .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
            .limit(1),
    );

    return row ?? null;
}

export interface BasisAuthIdentity {
    issuer: string;
    subject: string;
    email: string;
    name?: string;
}

/**
 * Links an authenticated basis-auth identity to a local user without changing the
 * local integer id that owns teams, votes, and submissions.
 */
export async function findOrLinkBasisAuthUser(
    event: H3Event,
    identity: BasisAuthIdentity,
): Promise<User> {
    const normalizedEmail = identity.email.trim().toLowerCase();
    const trimmedName = identity.name?.trim() || null;

    return event.context.drizzle.transaction(async (tx) => {
        const linked = await firstRow(
            tx
                .select()
                .from(users)
                .where(
                    and(
                        eq(users.auth_issuer, identity.issuer),
                        eq(users.auth_subject, identity.subject),
                    ),
                )
                .limit(1),
        );

        if (linked) {
            const emailOwner = await firstRow(
                tx
                    .select()
                    .from(users)
                    .where(eq(sql`lower(${users.email})`, normalizedEmail))
                    .limit(1),
            );
            if (emailOwner && emailOwner.id !== linked.id) {
                throw createError({
                    statusCode: 409,
                    message: "The email belongs to another account",
                });
            }

            return (await firstRow(
                tx
                    .update(users)
                    .set({ email: normalizedEmail, ...(trimmedName ? { name: trimmedName } : {}) })
                    .where(eq(users.id, linked.id))
                    .returning(),
            ))!;
        }

        const emailMatch = await firstRow(
            tx
                .select()
                .from(users)
                .where(eq(sql`lower(${users.email})`, normalizedEmail))
                .limit(1),
        );

        if (emailMatch?.auth_subject || emailMatch?.auth_issuer) {
            throw createError({
                statusCode: 409,
                message: "The email is linked to another identity",
            });
        }

        if (emailMatch) {
            return (await firstRow(
                tx
                    .update(users)
                    .set({
                        auth_issuer: identity.issuer,
                        auth_subject: identity.subject,
                        ...(trimmedName ? { name: trimmedName } : {}),
                    })
                    .where(eq(users.id, emailMatch.id))
                    .returning(),
            ))!;
        }

        return (await firstRow(
            tx
                .insert(users)
                .values({
                    email: normalizedEmail,
                    name: trimmedName,
                    auth_issuer: identity.issuer,
                    auth_subject: identity.subject,
                })
                .returning(),
        ))!;
    });
}

export async function getUserByBasisAuthSubject(
    event: H3Event,
    issuer: string,
    subject: string,
): Promise<User | null> {
    return (
        (await firstRow(
            event.context.drizzle
                .select()
                .from(users)
                .where(and(eq(users.auth_issuer, issuer), eq(users.auth_subject, subject)))
                .limit(1),
        )) ?? null
    );
}

export async function updateUserName(event: H3Event, user: User) {
    const changed = await changedRows(
        event.context.drizzle
            .update(users)
            .set({ name: user.name })
            .where(eq(users.id, user.id))
            .returning({ id: users.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

/**
 * @deprecated Profile reference changes must use the lifecycle-locked profile
 * route so the PostgreSQL advisory lock spans the object and database update.
 */
export async function updateUserProfileTheme(event: H3Event, user: User) {
    const changed = await changedRows(
        event.context.drizzle
            .update(users)
            .set({ profile_theme: user.profile_theme })
            .where(eq(users.id, user.id))
            .returning({ id: users.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

/**
 * @deprecated Profile reference changes must use the lifecycle-locked profile
 * route so the PostgreSQL advisory lock spans the object and database update.
 */
export async function updateUserProfilePicture(event: H3Event, user: User) {
    const changed = await changedRows(
        event.context.drizzle
            .update(users)
            .set({ profile_picture: user.profile_picture })
            .where(eq(users.id, user.id))
            .returning({ id: users.id }),
    );

    if (changed === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

export async function deleteUsers(event: H3Event, userIDs: number[]) {
    if (userIDs.length === 0) return;

    await event.context.drizzle.transaction(async (tx) => {
        await tx.delete(teamScores).where(inArray(teamScores.judge_user_id, userIDs));
        await tx
            .delete(ballotScores)
            .where(
                inArray(
                    ballotScores.ballot_id,
                    tx
                        .select({ id: ballots.id })
                        .from(ballots)
                        .where(inArray(ballots.user_id, userIDs)),
                ),
            );
        await tx.delete(ballots).where(inArray(ballots.user_id, userIDs));
        await tx.delete(peerVotingScores).where(inArray(peerVotingScores.user_id, userIDs));
        await tx.delete(userPastTeams).where(inArray(userPastTeams.user_id, userIDs));

        // Retain provider clients for audit, but detach deleted owners.
        await tx
            .update(oauth2Applications)
            .set({ owner_id: null })
            .where(inArray(oauth2Applications.owner_id, userIDs));
        await tx.delete(users).where(inArray(users.id, userIDs));
    });
}
