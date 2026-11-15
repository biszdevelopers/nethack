import { accessTokenClaimsSchema } from "@basis/schema/auth";
import { createError, type H3Event } from "h3";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { BasisAuthConfig } from "./basis-auth";
import { isBasisCredentialRevoked } from "./database/basis-auth-revocations";

export const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 0;
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function verifyBasisAuthJWT(
    token: string,
    config: BasisAuthConfig,
    typ: "at+jwt" | "at-revocation+jwt" | "logout+jwt",
    clockTolerance = 0,
) {
    let jwks = jwksByIssuer.get(config.issuer);
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL("/oauth/jwks", config.issuer));
        jwksByIssuer.set(config.issuer, jwks);
    }
    return jwtVerify(token, jwks, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.resource,
        typ,
        requiredClaims: ["exp"],
        clockTolerance,
    });
}

export function invalidAccessToken() {
    return createError({
        statusCode: 401,
        statusMessage: "invalid_token",
        message: "Invalid access token",
    });
}

export async function verifyAccessToken(
    event: H3Event,
    token: string,
    config: BasisAuthConfig,
    options: { allowExpiredForRefresh?: boolean; sessionIssuedAt?: number } = {},
) {
    const verified = await verifyBasisAuthJWT(
        token,
        config,
        "at+jwt",
        ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
    )
        .then(({ payload }) => payload)
        .catch((error: unknown) => {
            // JOSE verifies the signature, token type, issuer and audience before checking exp.
            if (options.allowExpiredForRefresh && error instanceof errors.JWTExpired) {
                return error.payload;
            }
            console.warn("[Basis Auth] Access token JWT validation failed");
            throw invalidAccessToken();
        });
    const claims = accessTokenClaimsSchema.safeParse(verified);
    if (!claims.success) {
        console.warn("[Basis Auth] Access token claims validation failed");
        throw invalidAccessToken();
    }
    const revoked = await isBasisCredentialRevoked(
        event.context.drizzle,
        claims.data,
        options.sessionIssuedAt ?? claims.data.iat,
        Math.floor(Date.now() / 1000),
    ).catch(() => {
        console.error("[Basis Auth] Revocation lookup failed");
        throw createError({ statusCode: 503, message: "Authentication temporarily unavailable" });
    });
    if (revoked) {
        console.warn("[Basis Auth] Access token or session revoked");
        throw invalidAccessToken();
    }
    return claims.data;
}
