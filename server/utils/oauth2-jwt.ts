import type { H3Event } from "h3";
import { setResponseHeader } from "h3";
import type { AccessTokenClaims } from "@basis/schema/auth";
import { getUserByBasisAuthSubject } from "./database/users";
import { getBasisAuthConfig, getFreshBasisAuthUserSession } from "./basis-auth";
import { invalidAccessToken, verifyAccessToken } from "./basis-auth-jwt";

export type OAuth2JWTPayload = AccessTokenClaims;

export function extractBearerToken(event: H3Event): string {
    const authorization = getHeader(event, "authorization");
    const match = authorization?.trim().match(/^Bearer[ \t]+(\S+)$/i);
    if (!match?.[1]) {
        console.warn("[Basis Auth] Malformed bearer authorization");
        throw invalidAccessToken();
    }
    return match[1];
}

export async function verifyOAuth2JWT(event: H3Event): Promise<OAuth2JWTPayload> {
    if (getHeader(event, "authorization") !== undefined) {
        try {
            return await verifyAccessToken(event, extractBearerToken(event), getBasisAuthConfig());
        } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 401) {
                setResponseHeader(event, "WWW-Authenticate", 'Bearer error="invalid_token"');
            }
            throw error;
        }
    }
    const session = await getFreshBasisAuthUserSession(event);
    if (!session) throw invalidAccessToken();
    return session.payload;
}

/** Resolve the stable Basis Auth subject to its linked local user. */
export async function resolveOAuth2User(event: H3Event, payload: Pick<OAuth2JWTPayload, "sub">) {
    if (!payload.sub) throw invalidAccessToken();

    const user = await getUserByBasisAuthSubject(event, getBasisAuthConfig().issuer, payload.sub);
    if (!user) {
        throw createError({
            statusCode: 404,
            message: "User not found",
        });
    }

    return user;
}

export interface OAuth2JWTContext {
    payload: OAuth2JWTPayload;
    permissions: string[];
    user?: User;
}
