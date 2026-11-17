import type { H3Event } from "h3";
import { accessTokenClaimsSchema, type AccessTokenClaims } from "@basis/schema/auth";
import { getUserByBasisAuthSubject } from "./database/users";
import { getBasisAuthConfig, getFreshBasisAuthUserSession } from "./basis-auth";
import { verifyBasisAuthJwt } from "./basis-auth-jwks";
import { assertAccessTokenActive, invalidAccessToken } from "./basis-auth-state";

// ------------------------------------------------------------------
// Low-level: verify a raw JWT string
// ------------------------------------------------------------------

export type OAuth2JWTPayload = AccessTokenClaims;

/**
 * Verify a raw JWT access token and return its payload.
 * Throws 401 errors for invalid, revoked, or expired tokens.
 */
export async function verifyAccessToken(token: string, event: H3Event): Promise<OAuth2JWTPayload> {
    if (!token) invalidAccessToken();

    let payload: OAuth2JWTPayload;
    try {
        payload = accessTokenClaimsSchema.parse(
            await verifyBasisAuthJwt(token, {
                typ: "at+jwt",
                audience: getBasisAuthConfig().resource,
            }),
        );
    } catch {
        invalidAccessToken();
    }
    await assertAccessTokenActive(event, payload);
    return payload;
}

// ------------------------------------------------------------------
// Mid-level: extract Bearer token from H3 event
// ------------------------------------------------------------------

/**
 * Extract the Bearer token from the Authorization header.
 * Throws 401 if the header is missing or malformed.
 */
export function extractBearerToken(event: H3Event): string {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
        invalidAccessToken();
    }

    const token = authHeader.slice(7).trim();
    if (!token) invalidAccessToken();

    return token;
}

// ------------------------------------------------------------------
// Mid-level: verify JWT from H3 event
// ------------------------------------------------------------------

/**
 * Extract and verify the Bearer token from an H3 event.
 * Returns the decoded JWT payload.
 */
export async function verifyOAuth2JWT(event: H3Event): Promise<OAuth2JWTPayload> {
    const authorization = getHeader(event, "authorization");
    const token = authorization
        ? extractBearerToken(event)
        : (await getFreshBasisAuthUserSession(event))?.tokens.accessToken;
    if (!token) invalidAccessToken();
    return await verifyAccessToken(token, event);
}

// ------------------------------------------------------------------
// User helper
// ------------------------------------------------------------------

/**
 * Resolve the stable basis-auth subject, then fetch its linked local user.
 */
export async function resolveOAuth2User(event: H3Event, payload: Pick<OAuth2JWTPayload, "sub">) {
    if (!payload.sub) invalidAccessToken();

    const validated = event.context.basisAuthValidatedUser;
    const user =
        validated?.subject === payload.sub
            ? validated.user
            : await getUserByBasisAuthSubject(event, getBasisAuthConfig().issuer, payload.sub);
    if (!user) invalidAccessToken();

    return user;
}

export interface OAuth2JWTContext {
    payload: OAuth2JWTPayload;
    permissions: string[];
    user?: User;
}
