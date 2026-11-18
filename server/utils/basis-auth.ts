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
import {
    isLoopbackHost,
    isLoopbackHttpOrigin,
    isValidE2ELoopbackOrigin,
} from "~~/server/utils/environment-validation";
import { getBasisAuthPictureUrl } from "~~/server/utils/profile";

export const BASIS_AUTH_CALLBACK_PATH = "/api/auth/basis/callback";
const FLOW_MAX_AGE_SECONDS = 10 * 60;
const OIDC_TIMEOUT_MS = 8000;

/** Bound every openid-client network call; the library has no default deadline. */
function withOidcDeadline<T>(work: Promise<T>, label: string): Promise<T> {
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = reject;
    });
    const timer = setTimeout(
        () => rejectDeadline(new Error(`basis-auth ${label} timed out after ${OIDC_TIMEOUT_MS}ms`)),
        OIDC_TIMEOUT_MS,
    );
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
export const BASIS_AUTH_REQUESTED_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
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
        !(
            isLoopbackHttpOrigin(config.issuer) &&
            isLoopbackHost(process.env.NITRO_HOST || process.env.HOST)
        ) &&
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

/**
 * Private listener settings. The backchannel receiver cannot verify a webhook
 * or receive events without them, so production treats them as required.
 */
export function getBasisAuthInternalConfig():
    | { internalUrl: string; resourceSecret: string }
    | undefined {
    const internalUrl = process.env.BASIS_AUTH_INTERNAL_URL?.trim();
    const resourceSecret = process.env.BASIS_AUTH_RESOURCE_SECRET?.trim();
    if (!internalUrl || !resourceSecret) return undefined;
    return { internalUrl: internalUrl.replace(/\/+$/, ""), resourceSecret };
}

export function sanitizePostLoginRedirect(value?: unknown): string | undefined {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
        return undefined;
    const parsed = new URL(value, "https://nethack.invalid");
    if (parsed.origin !== "https://nethack.invalid") return undefined;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // URL normalization can turn "/..//evil.com" into a protocol-relative URL.
    return path.startsWith("//") ? undefined : path;
}

const discoveredConfigurations = new Map<string, Promise<oidc.Configuration>>();

export function getBasisAuthOidcConfiguration(config = getBasisAuthConfig()) {
    const cacheKey = `${config.issuer}\0${config.clientId}\0${config.clientSecret}`;
    let discovered = discoveredConfigurations.get(cacheKey);
    if (!discovered) {
        discovered = withOidcDeadline(
            oidc.discovery(
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
            ),
            "discovery",
        ).catch((error) => {
            // A temporary discovery outage must not poison this process forever.
            discoveredConfigurations.delete(cacheKey);
            throw error;
        });
        discoveredConfigurations.set(cacheKey, discovered);
    }
    return discovered;
}

export async function beginBasisAuthFlow(postLoginRedirect?: string, preLoginUserId?: number) {
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
            preLoginUserId,
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
    const tokens = await withOidcDeadline(
        oidc.authorizationCodeGrant(oidcConfiguration, canonicalCallbackUrl, {
            pkceCodeVerifier: transaction.codeVerifier,
            expectedState: transaction.state,
            expectedNonce: transaction.nonce,
        }),
        "token exchange",
    );
    const claims = tokens.claims();
    if (!claims?.sub || !tokens.access_token || !tokens.refresh_token) {
        throw new Error("basis-auth did not return a complete token set");
    }

    const userInfo = await withOidcDeadline(
        oidc.fetchUserInfo(oidcConfiguration, tokens.access_token, claims.sub),
        "UserInfo",
    );
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
    return normalizeTokenSet(
        await withOidcDeadline(
            oidc.refreshTokenGrant(oidcConfiguration, refreshToken),
            "token refresh",
        ),
    );
}

// Refresh a minute early so a retry or clock skew cannot strand the session.
const REFRESH_BUFFER_MS = 60_000;
const refreshes = new Map<string, Promise<StoredBasisAuthTokens>>();
// Short-lived coordination state for cross-request refresh races. Remembering a
// completed rotation stops a second tab holding the old token from clearing the
// valid cookie; remembering logout stops an in-flight refresh from restoring a
// session after the user signed out.
const TOKEN_EVENT_TTL_MS = 60_000;
const rotatedTokens = new Map<string, { tokens: StoredBasisAuthTokens; at: number }>();
const loggedOutTokens = new Map<string, number>();

function pruneTokenEvents(now: number): void {
    for (const [token, value] of rotatedTokens) {
        if (now - value.at > TOKEN_EVENT_TTL_MS) rotatedTokens.delete(token);
    }
    for (const [token, at] of loggedOutTokens) {
        if (now - at > TOKEN_EVENT_TTL_MS) loggedOutTokens.delete(token);
    }
}

/** Read the encrypted token cookie and rotate it when its access token is near expiry. */
export async function getFreshBasisAuthUserSession(
    event: H3Event,
): Promise<BasisAuthUserSession | undefined> {
    const session = readBasisAuthUserSession(event);
    if (!session) return undefined;
    if (session.tokens.accessTokenExpiresAt > Date.now() + REFRESH_BUFFER_MS) return session;

    const refreshToken = session.tokens.refreshToken;
    pruneTokenEvents(Date.now());
    // A logout that landed after this request started must win: never re-seal a
    // session for a token that has already been revoked.
    if (loggedOutTokens.has(refreshToken)) {
        clearBasisAuthUserSession(event);
        return undefined;
    }

    let pending = refreshes.get(refreshToken);
    if (!pending) {
        pending = refreshBasisAuthTokens(refreshToken)
            .then((tokens) => ({
                accessToken: tokens.accessToken,
                accessTokenExpiresAt: tokens.expiresAt,
                refreshToken: tokens.refreshToken,
            }))
            .finally(() => refreshes.delete(refreshToken));
        refreshes.set(refreshToken, pending);
    }

    try {
        const tokens = await pending;
        if (loggedOutTokens.has(refreshToken)) {
            clearBasisAuthUserSession(event);
            return undefined;
        }
        rotatedTokens.set(refreshToken, { tokens, at: Date.now() });
        establishBasisAuthUserSession(event, session.userId, tokens);
        return { userId: session.userId, tokens };
    } catch {
        // Another request may already have rotated this exact refresh token.
        // Reuse its result instead of clobbering the newer valid cookie.
        const rotated = rotatedTokens.get(refreshToken);
        if (rotated && !loggedOutTokens.has(refreshToken)) {
            establishBasisAuthUserSession(event, session.userId, rotated.tokens);
            return { userId: session.userId, tokens: rotated.tokens };
        }
        clearBasisAuthUserSession(event);
        return undefined;
    }
}

export async function revokeBasisAuthToken(refreshToken: string) {
    // Record the intent before the network call so an in-flight refresh cannot
    // re-seal the cookie after logout's deletion response reaches the browser.
    loggedOutTokens.set(refreshToken, Date.now());
    const config = getBasisAuthConfig();
    const oidcConfiguration = await getBasisAuthOidcConfiguration(config);
    await withOidcDeadline(
        oidc.tokenRevocation(oidcConfiguration, refreshToken, {
            token_type_hint: "refresh_token",
        }),
        "token revocation",
    );
}
