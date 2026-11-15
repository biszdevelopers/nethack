import { lte, sql } from "drizzle-orm";
import type { DrizzleDatabase } from "~~/server/database";
import { basisAccessTokenRevocations, basisSubjectLogouts } from "~~/server/database/schema";

export async function recordBasisAccessTokenRevocation(
    db: DrizzleDatabase,
    issuer: string,
    jti: string,
    validAfter: number,
    retainUntil: number,
) {
    await db
        .insert(basisAccessTokenRevocations)
        .values({ issuer, jti, validAfter, retainUntil })
        .onConflictDoUpdate({
            target: [basisAccessTokenRevocations.issuer, basisAccessTokenRevocations.jti],
            set: {
                validAfter: sql`least(${basisAccessTokenRevocations.validAfter}, excluded.valid_after)`,
                retainUntil: sql`greatest(${basisAccessTokenRevocations.retainUntil}, excluded.retain_until)`,
            },
        });
}

export async function recordBasisSubjectLogout(
    db: DrizzleDatabase,
    issuer: string,
    subject: string,
    issuedAt: number,
) {
    await db
        .insert(basisSubjectLogouts)
        .values({ issuer, subject, issuedAt })
        .onConflictDoUpdate({
            target: [basisSubjectLogouts.issuer, basisSubjectLogouts.subject],
            set: { issuedAt: sql`greatest(${basisSubjectLogouts.issuedAt}, excluded.issued_at)` },
        });
}

export async function isBasisCredentialRevoked(
    db: DrizzleDatabase,
    claims: { iss: string; sub: string; jti: string },
    sessionIssuedAt: number,
    now: number,
): Promise<boolean> {
    const [result] = await db.execute<{ revoked: boolean }>(sql`
        select exists (
            select 1 from ${basisAccessTokenRevocations}
            where ${basisAccessTokenRevocations.issuer} = ${claims.iss}
              and ${basisAccessTokenRevocations.jti} = ${claims.jti}
              and ${basisAccessTokenRevocations.validAfter} <= ${now}
        ) or exists (
            select 1 from ${basisSubjectLogouts}
            where ${basisSubjectLogouts.issuer} = ${claims.iss}
              and ${basisSubjectLogouts.subject} = ${claims.sub}
              and ${basisSubjectLogouts.issuedAt} >= ${sessionIssuedAt}
        ) as revoked
    `);
    return result!.revoked;
}

export async function cleanBasisAccessTokenRevocations(db: DrizzleDatabase, now: number) {
    await db
        .delete(basisAccessTokenRevocations)
        .where(lte(basisAccessTokenRevocations.retainUntil, now));
}
