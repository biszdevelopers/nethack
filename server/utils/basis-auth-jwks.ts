import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getBasisAuthConfig } from "./basis-auth";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Cached basis-auth public keys. Rotation is picked up by the remote set. */
export function getBasisAuthJwks(issuer: string) {
    let jwks = jwksByIssuer.get(issuer);
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL("/oauth/jwks", issuer));
        jwksByIssuer.set(issuer, jwks);
    }
    return jwks;
}

/** Verify a basis-auth JWT against RS256, the exact issuer, and the requested `typ`. */
export async function verifyBasisAuthJwt(
    token: string,
    options: { typ: string; audience: string },
): Promise<JWTPayload> {
    const config = getBasisAuthConfig();
    const { payload } = await jwtVerify(token, getBasisAuthJwks(config.issuer), {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: options.audience,
        typ: options.typ,
    });
    return payload;
}
