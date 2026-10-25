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

export async function getUser(event: H3Event, userID: number): Promise<User | null> {
    const row = event.context.drizzle.select().from(users).where(eq(users.id, userID)).get();

    return row ?? null;
}

export async function getUserByEmail(event: H3Event, email: string): Promise<User | null> {
    const row = event.context.drizzle
        .select()
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
        .get();

    return row ?? null;
}

export interface BasisAuthIdentity {
    issuer: string;
    subject: string;
    email: string;
    name?: string;
}

/**
 * Links a verified basis-auth identity to a local user without changing the
 * local integer id that owns teams, votes, and submissions.
 */
export async function findOrLinkBasisAuthUser(
    event: H3Event,
    identity: BasisAuthIdentity,
): Promise<User> {

    const normalizedEmail = identity.email.trim().toLowerCase();
    const trimmedName = identity.name?.trim() || null;

    return event.context.drizzle.transaction((tx) => {
        const linked = tx
            .select()
            .from(users)
            .where(
                and(
                    eq(users.auth_issuer, identity.issuer),
                    eq(users.auth_subject, identity.subject),
                ),
            )
            .get();

        if (linked) {
            const emailOwner = tx
                .select()
                .from(users)
                .where(eq(sql`lower(${users.email})`, normalizedEmail))
                .get();
            if (emailOwner && emailOwner.id !== linked.id) {
                throw createError({
                    statusCode: 409,
                    message: "The verified email belongs to another account",
                });
            }

            return tx
                .update(users)
                .set({ email: normalizedEmail, ...(trimmedName ? { name: trimmedName } : {}) })
                .where(eq(users.id, linked.id))
                .returning()
                .get()!;
        }

        const emailMatch = tx
            .select()
            .from(users)
            .where(eq(sql`lower(${users.email})`, normalizedEmail))
            .get();

        if (emailMatch?.auth_subject || emailMatch?.auth_issuer) {
            throw createError({
                statusCode: 409,
                message: "The verified email is linked to another identity",
            });
        }

        if (emailMatch) {
            return tx
                .update(users)
                .set({
                    auth_issuer: identity.issuer,
                    auth_subject: identity.subject,
                    ...(trimmedName ? { name: trimmedName } : {}),
                })
                .where(eq(users.id, emailMatch.id))
                .returning()
                .get()!;
        }

        return tx
            .insert(users)
            .values({
                email: normalizedEmail,
                name: trimmedName,
                auth_issuer: identity.issuer,
                auth_subject: identity.subject,
            })
            .returning()
            .get()!;
    });
}

export async function getUserByBasisAuthSubject(
    event: H3Event,
    issuer: string,
    subject: string,
): Promise<User | null> {
    return (
        event.context.drizzle
            .select()
            .from(users)
            .where(and(eq(users.auth_issuer, issuer), eq(users.auth_subject, subject)))
            .get() ?? null
    );
}

export async function updateUserName(event: H3Event, user: User) {
    const result = event.context.drizzle
        .update(users)
        .set({ name: user.name })
        .where(eq(users.id, user.id))
        .run();

    if (result.changes === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

export async function updateUserProfileTheme(event: H3Event, user: User) {
    const result = event.context.drizzle
        .update(users)
        .set({ profile_theme: user.profile_theme })
        .where(eq(users.id, user.id))
        .run();

    if (result.changes === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

export async function updateUserProfilePicture(event: H3Event, user: User) {
    const result = event.context.drizzle
        .update(users)
        .set({ profile_picture: user.profile_picture })
        .where(eq(users.id, user.id))
        .run();

    if (result.changes === 0) {
        throw createError({
            status: 404,
            message: "User not found",
        });
    }
}

export async function deleteUsers(event: H3Event, userIDs: number[]) {
    for (const id of userIDs) {
        event.context.drizzle.transaction((tx) => {
            tx.delete(teamScores).where(eq(teamScores.judge_user_id, id)).run();

            tx.delete(ballotScores)
                .where(
                    inArray(
                        ballotScores.ballot_id,
                        tx.select({ id: ballots.id }).from(ballots).where(eq(ballots.user_id, id)),
                    ),
                )
                .run();

            tx.delete(ballots).where(eq(ballots.user_id, id)).run();

            tx.delete(peerVotingScores).where(eq(peerVotingScores.user_id, id)).run();

            tx.delete(userPastTeams).where(eq(userPastTeams.user_id, id)).run();

            // Keep retired provider records for audit and rollback, but detach
            // their ownership before removing the local user.
            tx.update(oauth2Applications)
                .set({ owner_id: null })
                .where(eq(oauth2Applications.owner_id, id))
                .run();

            tx.delete(users).where(eq(users.id, id)).run();
        });
    }
}
