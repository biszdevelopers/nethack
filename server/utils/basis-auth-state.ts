import type { H3Event } from "h3";
import { and, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { AccessTokenClaims } from "@basis/schema/auth";
import { revokedAccessTokens, users } from "~~/server/database/schema";
import { getBasisAuthConfig, getBasisAuthInternalConfig } from "./basis-auth";
import { isLoopbackHttpOrigin } from "./environment-validation";
import { firstRow } from "./database/query";

/** Retention past a token's own expiry, leaving room for verifier clock tolerance. */
const EXPIRY_RETENTION_SECONDS = 300;
/** Fallback for revocations whose signed event carried no token expiry. */
const UNKNOWN_EXPIRY_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const SUBJECT_CACHE_MS = 60_000;
const SUBJECT_FAILURE_BACKOFF_MS = 15_000;

export function invalidAccessToken(): never {
    throw createError({
        statusCode: 401,
        statusMessage: "invalid_token",
        message: "Invalid access token",
    });
}

const unixSeconds = () => Math.floor(Date.now() / 1000);

export async function isAccessTokenRevoked(event: H3Event, jti: string): Promise<boolean> {
    const row = await firstRow(
        event.context.drizzle
            .select({ jti: revokedAccessTokens.jti })
            .from(revokedAccessTokens)
            .where(
                and(
                    eq(revokedAccessTokens.jti, jti),
                    lte(revokedAccessTokens.valid_after, unixSeconds()),
                ),
            )
            .limit(1),
    );
    return Boolean(row);
}

/**
 * Record a delivered revocation. Delivery is retried and each event carries the
 * same access token, so the earliest `valid_after` wins.
 */
export async function revokeAccessToken(
    event: H3Event,
    input: { jti: string; validAfter: number; expiresAt: number | null },
): Promise<void> {
    const db = event.context.drizzle;
    await db
        .update(revokedAccessTokens)
        .set({ valid_after: input.validAfter })
        .where(
            and(
                eq(revokedAccessTokens.jti, input.jti),
                gt(revokedAccessTokens.valid_after, input.validAfter),
            ),
        );
    if (input.expiresAt !== null) {
        await db
            .update(revokedAccessTokens)
            .set({ expires_at: input.expiresAt })
            .where(
                and(eq(revokedAccessTokens.jti, input.jti), isNull(revokedAccessTokens.expires_at)),
            );
    }
    await db
        .insert(revokedAccessTokens)
        .values({
            jti: input.jti,
            valid_after: input.validAfter,
            expires_at: input.expiresAt,
        })
        .onConflictDoNothing({ target: revokedAccessTokens.jti });
    await db
        .delete(revokedAccessTokens)
        .where(
            or(
                and(
                    isNotNull(revokedAccessTokens.expires_at),
                    lt(revokedAccessTokens.expires_at, unixSeconds() - EXPIRY_RETENTION_SECONDS),
                ),
                lt(
                    revokedAccessTokens.valid_after,
                    unixSeconds() - UNKNOWN_EXPIRY_RETENTION_SECONDS,
                ),
            ),
        );
}

/** Invalidate every local session for a basis-auth logout subject. */
export async function endBasisAuthSubjectSessions(event: H3Event, subject: string): Promise<void> {
    const config = getBasisAuthConfig();
    await event.context.drizzle
        .update(users)
        .set({ tokens_valid_after: unixSeconds() })
        .where(and(eq(users.auth_issuer, config.issuer), eq(users.auth_subject, subject)));
}

interface SubjectState {
    disabled: boolean;
    tokensValidAfter: number | null;
}

const subjectCache = new Map<string, { state: SubjectState; expiresAt: number }>();
let subjectFailureUntil = 0;

/** Read the live user state from the basis-auth internal listener. */
async function loadBasisAuthSubjectState(subject: string): Promise<SubjectState | undefined> {
    const config = getBasisAuthInternalConfig();
    if (!config) return undefined;

    const cached = subjectCache.get(subject);
    if (cached && cached.expiresAt > Date.now()) return cached.state;
    if (Date.now() < subjectFailureUntil) {
        throw new Error("basis-auth user state is unavailable");
    }

    let response: Response;
    try {
        response = await fetch(
            new URL(`/internal/users/${encodeURIComponent(subject)}`, config.internalUrl),
            {
                headers: {
                    authorization: `Bearer ${config.resourceSecret}`,
                    "x-basis-resource": encodeURIComponent(getBasisAuthConfig().resource),
                },
                signal: AbortSignal.timeout(3000),
            },
        );
    } catch (error) {
        subjectFailureUntil = Date.now() + SUBJECT_FAILURE_BACKOFF_MS;
        throw error;
    }

    if (!response.ok) {
        await response.body?.cancel();
        // Only a definitive "no such user" answer is safe to stop retrying.
        subjectFailureUntil = response.status === 404 ? 0 : Date.now() + SUBJECT_FAILURE_BACKOFF_MS;
        throw new Error(`basis-auth user state returned ${response.status}`);
    }

    const body = (await response.json()) as {
        user?: { disabled?: unknown; tokensValidAfter?: unknown };
    };
    const rawBarrier = body.user?.tokensValidAfter;
    const tokensValidAfter =
        typeof rawBarrier === "string" || rawBarrier instanceof Date
            ? Date.parse(String(rawBarrier))
            : null;
    const state: SubjectState = {
        disabled: body.user?.disabled === true,
        tokensValidAfter:
            typeof tokensValidAfter === "number" && Number.isFinite(tokensValidAfter)
                ? tokensValidAfter
                : null,
    };
    subjectCache.set(subject, { state, expiresAt: Date.now() + SUBJECT_CACHE_MS });
    return state;
}

/**
 * Reject tokens revoked by jti, signed out through a backchannel logout, or
 * belonging to a disabled basis-auth user.
 */
export async function assertAccessTokenActive(
    event: H3Event,
    claims: Pick<AccessTokenClaims, "sub" | "iat" | "jti">,
): Promise<void> {
    if (await isAccessTokenRevoked(event, claims.jti)) invalidAccessToken();

    const local = await firstRow(
        event.context.drizzle
            .select({ tokens_valid_after: users.tokens_valid_after })
            .from(users)
            .where(
                and(
                    eq(users.auth_issuer, getBasisAuthConfig().issuer),
                    eq(users.auth_subject, claims.sub),
                ),
            )
            .limit(1),
    );
    if (local?.tokens_valid_after != null && claims.iat <= local.tokens_valid_after) {
        invalidAccessToken();
    }

    let state: SubjectState | undefined;
    try {
        state = await loadBasisAuthSubjectState(claims.sub);
    } catch {
        // Fail closed for a real deployment: an unreachable basis-auth must not
        // vouch for the subject. A loopback instance is a development target
        // even under NODE_ENV=production, so it keeps working without a route
        // to the remote private listener.
        if (
            process.env.NODE_ENV === "production" &&
            !isLoopbackHttpOrigin(process.env.CURRENT_URL_ORIGIN)
        ) {
            invalidAccessToken();
        }
    }
    if (
        state?.disabled ||
        (state?.tokensValidAfter != null && claims.iat * 1000 <= state.tokensValidAfter)
    ) {
        invalidAccessToken();
    }
}
