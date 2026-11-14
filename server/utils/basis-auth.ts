import type { H3Event } from "h3";
import * as oidc from "openid-client";
import { getPublicOrigin } from "~~/server/utils/oauth2";
import type { BasisAuthIdentity } from "~~/server/utils/database/users";
import {
    clearBasisAuthUserSession,
    establishBasisAuthUserSession,
    readBasisAuthUserSession,
    type BasisAuthFlowTransaction,
    type BasisAuthUserSession,
    type StoredBasisAuthTokens,
} from "~~/server/utils/basis-auth-session";
import { isValidE2ELoopbackOrigin } from "~~/server/utils/environment-validation";
import { getBasisAuthPictureUrl } from "~~/server/utils/profile";

export const BASIS_AUTH_CALLBACK_PATH = "/api/auth/basis/callback";
const FLOW_MAX_AGE_SECONDS = 10 * 60;
export const BASIS_AUTH_REQUESTED_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "nethack.access",
] as const;

export interface BasisAuthConfig {
    issuer: string;
    clientId: string;
    clientSecret: string;
    resource: string;
}

export function getBasisAuthConfig(): BasisAuthConfig {
    const config = {
        issuer: process.env.BASIS_AUTH_ISSUER?.replace(/\/+$/, "") || "",
        clientId: process.env.BASIS_AUTH_CLIENT_ID || "",
        clientSecret: process.env.BASIS_AUTH_CLIENT_SECRET || "",
        resource: process.env.BASIS_AUTH_RESOURCE || "devconnect://nethack.bisz.dev",
    };
    const missing = Object.entries(config)
        .filter(([, value]) => !value)
        .map(([name]) => name);
    if (missing.length > 0) {
        throw createError({
            statusCode: 500,
            message: `Missing basis-auth configuration: ${missing.join(", ")}`,
        });
    }
    let issuer: URL;
    try {
        issuer = new URL(config.issuer);
    } catch {
        throw createError({ statusCode: 500, message: "BASIS_AUTH_ISSUER must be a valid URL" });
    }
    if (!["http:", "https:"].includes(issuer.protocol)) {
        throw createError({
            statusCode: 500,
            message: "BASIS_AUTH_ISSUER must use HTTP or HTTPS",
        });
    }
    if (issuer.username || issuer.password) {
        throw createError({
            statusCode: 500,
            message: "BASIS_AUTH_ISSUER cannot contain credentials",
        });
    }
    const isolatedE2EIssuer =
        process.env.BASISHACKS_E2E === "1" &&
        issuer.protocol === "http:" &&
        issuer.hostname === "127.0.0.1" &&
        Boolean(issuer.port) &&
        issuer.pathname === "/" &&
        !issuer.search &&
        !issuer.hash &&
        isValidE2ELoopbackOrigin(
            process.env.CURRENT_URL_ORIGIN,
            process.env.NITRO_HOST || process.env.HOST,
            process.env.NITRO_PORT || process.env.PORT,
            process.env.NITRO_UNIX_SOCKET,
        );
    if (
        process.env.NODE_ENV === "production" &&
        issuer.protocol !== "https:" &&
        !isolatedE2EIssuer
    ) {
        throw createError({
            statusCode: 500,
            message: "BASIS_AUTH_ISSUER must use HTTPS in production",
        });
    }
    if (issuer.search || issuer.hash) {
        throw createError({
            statusCode: 500,
            message: "BASIS_AUTH_ISSUER cannot contain a query string or fragment",
        });
    }
    return config;
}

export function getBasisAuthCallbackUrl(): string {
    return new URL(BASIS_AUTH_CALLBACK_PATH, getPublicOrigin()).href;
}

export function sanitizePostLoginRedirect(value?: string): string | undefined {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
    try {
        const parsed = new URL(value, "https://basishacks.invalid");
        return parsed.origin === "https://basishacks.invalid"
            ? `${parsed.pathname}${parsed.search}${parsed.hash}`
            : undefined;
    } catch {
        return undefined;
    }
}

const discoveredConfigurations = new Map<string, Promise<oidc.Configuration>>();

export function getBasisAuthOidcConfiguration(config = getBasisAuthConfig()) {
    const cacheKey = `${config.issuer}\0${config.clientId}\0${config.clientSecret}`;
    let discovered = discoveredConfigurations.get(cacheKey);
    if (!discovered) {
        discovered = oidc
            .discovery(
                new URL(config.issuer),
                config.clientId,
                {
                    client_secret: config.clientSecret,
                    token_endpoint_auth_method: "client_secret_basic",
                },
                oidc.ClientSecretBasic(config.clientSecret),
                config.issuer.startsWith("http://")
                    ? { execute: [oidc.allowInsecureRequests] }
                    : undefined,
            )
            .catch((error) => {
                // A temporary discovery outage must not poison this process forever.
                discoveredConfigurations.delete(cacheKey);
                throw error;
            });
        discoveredConfigurations.set(cacheKey, discovered);
    }
    return discovered;
}

export async function beginBasisAuthFlow(postLoginRedirect?: string) {
    const config = getBasisAuthConfig();
    const oidcConfiguration = await getBasisAuthOidcConfiguration(config);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const url = oidc.buildAuthorizationUrl(oidcConfiguration, {
        redirect_uri: getBasisAuthCallbackUrl(),
        response_type: "code",
        scope: BASIS_AUTH_REQUESTED_SCOPES.join(" "),
        resource: config.resource,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    });

    return {
        url,
        transaction: {
            state,
            nonce,
            codeVerifier,
            startedAt: Date.now(),
            postLoginRedirect,
        },
    };
}

export async function completeBasisAuthFlow(
    callbackUrl: URL,
    transaction: Partial<BasisAuthFlowTransaction>,
): Promise<{
    identity: BasisAuthIdentity;
    tokens: { accessToken: string; refreshToken: string; expiresAt: number };
}> {
    if (!transaction.state || !transaction.nonce || !transaction.codeVerifier) {
        throw new Error("Login transaction is missing or expired");
    }
    if (
        typeof transaction.startedAt !== "number" ||
        Date.now() - transaction.startedAt > FLOW_MAX_AGE_SECONDS * 1000
    ) {
        throw new Error("Login transaction is missing or expired");
    }

    const config = getBasisAuthConfig();
    const oidcConfiguration = await getBasisAuthOidcConfiguration(config);
    const canonicalCallbackUrl = new URL(
        callbackUrl.pathname + callbackUrl.search,
        getPublicOrigin(),
    );
    const tokens = await oidc.authorizationCodeGrant(oidcConfiguration, canonicalCallbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
    });
    const claims = tokens.claims();
    if (!claims?.sub || !tokens.access_token || !tokens.refresh_token) {
        throw new Error("basis-auth did not return a complete token set");
    }

    const userInfo = await oidc.fetchUserInfo(oidcConfiguration, tokens.access_token, claims.sub);
    if (typeof userInfo.email !== "string" || !userInfo.email.trim()) {
        throw new Error("basis-auth did not return an email address");
    }

    return {
        identity: {
            issuer: config.issuer,
            subject: claims.sub,
            email: userInfo.email,
            name: typeof userInfo.name === "string" ? userInfo.name : undefined,
            picture:
                getBasisAuthPictureUrl(claims.picture, config.issuer) ??
                getBasisAuthPictureUrl(userInfo.picture, config.issuer),
        },
        tokens: normalizeTokenSet(tokens),
    };
}

function normalizeTokenSet(tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
}) {
    if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("basis-auth did not return a complete token set");
    }
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + Math.max(1, tokens.expires_in ?? 600) * 1000,
    };
}

export async function refreshBasisAuthTokens(refreshToken: string) {
    const config = getBasisAuthConfig();
    const oidcConfiguration = await getBasisAuthOidcConfiguration(config);
    return normalizeTokenSet(await oidc.refreshTokenGrant(oidcConfiguration, refreshToken));
}

const REFRESH_BUFFER_MS = 30_000;
const refreshes = new Map<string, Promise<StoredBasisAuthTokens>>();

/** Read the encrypted token cookie and rotate it when its access token is near expiry. */
export async function getFreshBasisAuthUserSession(
    event: H3Event,
): Promise<BasisAuthUserSession | undefined> {
    const session = readBasisAuthUserSession(event);
    if (!session) return undefined;
    if (session.tokens.accessTokenExpiresAt > Date.now() + REFRESH_BUFFER_MS) return session;

    let pending = refreshes.get(session.tokens.refreshToken);
    if (!pending) {
        pending = refreshBasisAuthTokens(session.tokens.refreshToken)
            .then((tokens) => ({
                accessToken: tokens.accessToken,
                accessTokenExpiresAt: tokens.expiresAt,
                refreshToken: tokens.refreshToken,
            }))
            .finally(() => refreshes.delete(session.tokens.refreshToken));
        refreshes.set(session.tokens.refreshToken, pending);
    }

    try {
        const tokens = await pending;
        establishBasisAuthUserSession(event, session.userId, tokens);
        return { userId: session.userId, tokens };
    } catch {
        clearBasisAuthUserSession(event);
        return undefined;
    }
}

export async function revokeBasisAuthToken(refreshToken: string) {
    const config = getBasisAuthConfig();
    const oidcConfiguration = await getBasisAuthOidcConfiguration(config);
    await oidc.tokenRevocation(oidcConfiguration, refreshToken, {
        token_type_hint: "refresh_token",
    });
}
