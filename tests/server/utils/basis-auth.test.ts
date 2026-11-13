import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidc = vi.hoisted(() => ({
    discovery: vi.fn(),
    ClientSecretBasic: vi.fn(() => "client-auth"),
    allowInsecureRequests: vi.fn(),
    randomState: vi.fn(() => "state"),
    randomNonce: vi.fn(() => "nonce"),
    randomPKCECodeVerifier: vi.fn(() => "verifier"),
    calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
    buildAuthorizationUrl: vi.fn(() => new URL("https://auth.example.test/oauth/authorize")),
    authorizationCodeGrant: vi.fn(),
    fetchUserInfo: vi.fn(),
    refreshTokenGrant: vi.fn(),
    tokenRevocation: vi.fn(),
}));

vi.mock("openid-client", () => oidc);
vi.mock("~~/server/utils/oauth2", () => ({
    getPublicOrigin: () => "https://hacks.example.test",
}));

import {
    beginBasisAuthFlow,
    completeBasisAuthFlow,
    getBasisAuthConfig,
    getBasisAuthCallbackUrl,
    getBasisAuthOidcConfiguration,
    getFreshBasisAuthUserSession,
    refreshBasisAuthTokens,
    revokeBasisAuthToken,
    sanitizePostLoginRedirect,
} from "~~/server/utils/basis-auth";
import {
    BASIS_AUTH_TOKEN_COOKIE,
    establishBasisAuthUserSession,
} from "~~/server/utils/basis-auth-session";

let sessionCookies = new WeakMap<object, Map<string, string>>();

const cookiesFor = (event: object) => {
    let cookies = sessionCookies.get(event);
    if (!cookies) {
        cookies = new Map<string, string>();
        sessionCookies.set(event, cookies);
    }
    return cookies;
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    sessionCookies = new WeakMap();
    process.env.BASIS_AUTH_ISSUER = "https://auth.example.test/";
    process.env.BASIS_AUTH_CLIENT_ID = "basishacks";
    process.env.BASIS_AUTH_CLIENT_SECRET = "secret";
    process.env.BASIS_AUTH_RESOURCE = "devconnect://nethack.bisz.dev";
    process.env.BASIS_AUTH_COOKIE_SECRET = "a-secure-cookie-secret-that-is-at-least-32-bytes";
    vi.stubGlobal("createError", (input: any) => Object.assign(new Error(input.message), input));
    vi.stubGlobal("getCookie", (event: object, name: string) => cookiesFor(event).get(name));
    vi.stubGlobal("setCookie", (event: object, name: string, value: string) => {
        cookiesFor(event).set(name, value);
    });
    vi.stubGlobal("deleteCookie", (event: object, name: string) => {
        cookiesFor(event).delete(name);
    });
    oidc.discovery.mockReset().mockResolvedValue("configuration");
    oidc.ClientSecretBasic.mockReset().mockReturnValue("client-auth");
    oidc.allowInsecureRequests.mockReset();
    oidc.randomState.mockReset().mockReturnValue("state");
    oidc.randomNonce.mockReset().mockReturnValue("nonce");
    oidc.randomPKCECodeVerifier.mockReset().mockReturnValue("verifier");
    oidc.calculatePKCECodeChallenge.mockReset().mockResolvedValue("challenge");
    oidc.buildAuthorizationUrl
        .mockReset()
        .mockReturnValue(new URL("https://auth.example.test/oauth/authorize"));
    oidc.authorizationCodeGrant.mockReset();
    oidc.fetchUserInfo.mockReset();
    oidc.refreshTokenGrant.mockReset();
    oidc.tokenRevocation.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("basis-auth authorization-code flow", () => {
    it.each([
        ["BASIS_AUTH_ISSUER", "issuer"],
        ["BASIS_AUTH_CLIENT_ID", "clientId"],
        ["BASIS_AUTH_CLIENT_SECRET", "clientSecret"],
    ])("requires %s", (environmentKey, configKey) => {
        delete process.env[environmentKey];

        expect(() => getBasisAuthConfig()).toThrow(
            `Missing basis-auth configuration: ${configKey}`,
        );
    });

    it("uses the documented resource when it is not configured and trims issuer slashes", () => {
        delete process.env.BASIS_AUTH_RESOURCE;

        expect(getBasisAuthConfig()).toEqual({
            issuer: "https://auth.example.test",
            clientId: "basishacks",
            clientSecret: "secret",
            resource: "devconnect://nethack.bisz.dev",
        });
    });

    it("rejects malformed issuers and issuer URLs containing query strings or fragments", () => {
        process.env.BASIS_AUTH_ISSUER = "not a URL";
        expect(() => getBasisAuthConfig()).toThrow("must be a valid URL");

        process.env.BASIS_AUTH_ISSUER = "https://auth.example.test?tenant=other";
        expect(() => getBasisAuthConfig()).toThrow("cannot contain a query string or fragment");

        process.env.BASIS_AUTH_ISSUER = "https://auth.example.test#tenant";
        expect(() => getBasisAuthConfig()).toThrow("cannot contain a query string or fragment");
    });

    it("rejects non-HTTP issuer schemes and issuer credentials", () => {
        process.env.BASIS_AUTH_ISSUER = "javascript:alert(1)";
        expect(() => getBasisAuthConfig()).toThrow("must use HTTP or HTTPS");

        process.env.BASIS_AUTH_ISSUER = "https://client:secret@auth.example.test";
        expect(() => getBasisAuthConfig()).toThrow("cannot contain credentials");
    });

    it("requires HTTPS for a production issuer", () => {
        const originalNodeEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            process.env.BASIS_AUTH_ISSUER = "http://auth.example.test";
            expect(() => getBasisAuthConfig()).toThrow("must use HTTPS in production");
        } finally {
            if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = originalNodeEnv;
            process.env.BASIS_AUTH_ISSUER = "https://auth.example.test/";
        }
    });

    it("allows HTTP only for the isolated numeric loopback E2E issuer in production", () => {
        const environmentKeys = [
            "NODE_ENV",
            "BASISHACKS_E2E",
            "CURRENT_URL_ORIGIN",
            "NITRO_HOST",
            "NITRO_PORT",
            "NITRO_UNIX_SOCKET",
            "HOST",
            "PORT",
        ] as const;
        const originalEnvironment = Object.fromEntries(
            environmentKeys.map((key) => [key, process.env[key]]),
        );
        try {
            process.env.NODE_ENV = "production";
            process.env.BASISHACKS_E2E = "1";
            process.env.CURRENT_URL_ORIGIN = "http://127.0.0.1:3005";
            process.env.NITRO_HOST = "127.0.0.1";
            process.env.NITRO_PORT = "3005";
            process.env.BASIS_AUTH_ISSUER = "http://127.0.0.1:45123";

            expect(getBasisAuthConfig().issuer).toBe("http://127.0.0.1:45123");

            delete process.env.NITRO_HOST;
            delete process.env.NITRO_PORT;
            process.env.HOST = "127.0.0.1";
            process.env.PORT = "3005";
            expect(getBasisAuthConfig().issuer).toBe("http://127.0.0.1:45123");

            process.env.NITRO_HOST = "127.0.0.1";
            process.env.NITRO_PORT = "3005";
            process.env.BASIS_AUTH_ISSUER = "http://localhost:45123";
            expect(() => getBasisAuthConfig()).toThrow("must use HTTPS in production");

            process.env.BASIS_AUTH_ISSUER = "http://127.0.0.1:45123";
            process.env.NITRO_HOST = "0.0.0.0";
            expect(() => getBasisAuthConfig()).toThrow("must use HTTPS in production");
        } finally {
            for (const key of environmentKeys) {
                const value = originalEnvironment[key];
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            process.env.BASIS_AUTH_ISSUER = "https://auth.example.test/";
        }
    });

    it("caches discovery by client configuration and enables HTTP only for HTTP issuers", async () => {
        const httpConfig = {
            issuer: "http://local-auth.test",
            clientId: "client-http-cache-test",
            clientSecret: "secret-http-cache-test",
            resource: "resource",
        };

        const first = getBasisAuthOidcConfiguration(httpConfig);
        const second = getBasisAuthOidcConfiguration(httpConfig);

        expect(second).toBe(first);
        await expect(first).resolves.toBe("configuration");
        expect(oidc.discovery).toHaveBeenCalledTimes(1);
        expect(oidc.discovery).toHaveBeenCalledWith(
            new URL(httpConfig.issuer),
            httpConfig.clientId,
            {
                client_secret: httpConfig.clientSecret,
                token_endpoint_auth_method: "client_secret_basic",
            },
            "client-auth",
            { execute: [oidc.allowInsecureRequests] },
        );
    });

    it("does not enable insecure requests for HTTPS discovery", async () => {
        const config = {
            issuer: "https://dedicated-auth.test",
            clientId: "client-https-options-test",
            clientSecret: "secret-https-options-test",
            resource: "resource",
        };

        await expect(getBasisAuthOidcConfiguration(config)).resolves.toBe("configuration");

        expect(oidc.discovery).toHaveBeenCalledWith(
            new URL(config.issuer),
            config.clientId,
            expect.any(Object),
            "client-auth",
            undefined,
        );
    });

    it("evicts a rejected discovery promise so a later request can retry", async () => {
        const config = {
            issuer: "https://retry-auth.test",
            clientId: "client-discovery-retry-test",
            clientSecret: "secret-discovery-retry-test",
            resource: "resource",
        };
        const outage = new Error("temporary discovery outage");
        oidc.discovery.mockRejectedValueOnce(outage).mockResolvedValueOnce("recovered");

        await expect(getBasisAuthOidcConfiguration(config)).rejects.toBe(outage);
        await expect(getBasisAuthOidcConfiguration(config)).resolves.toBe("recovered");
        expect(oidc.discovery).toHaveBeenCalledTimes(2);
    });

    it("uses S256 PKCE, state, nonce, the configured resource, and derived callback URL", async () => {
        const result = await beginBasisAuthFlow("/dashboard");

        expect(getBasisAuthCallbackUrl()).toBe(
            "https://hacks.example.test/api/auth/basis/callback",
        );
        expect(oidc.discovery).toHaveBeenCalledWith(
            new URL("https://auth.example.test"),
            "basishacks",
            expect.objectContaining({ token_endpoint_auth_method: "client_secret_basic" }),
            "client-auth",
            undefined,
        );
        expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith("configuration", {
            redirect_uri: "https://hacks.example.test/api/auth/basis/callback",
            response_type: "code",
            scope: "openid profile email offline_access nethack.access",
            resource: "devconnect://nethack.bisz.dev",
            state: "state",
            nonce: "nonce",
            code_challenge: "challenge",
            code_challenge_method: "S256",
        });
        expect(result.transaction).toEqual({
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: expect.any(Number),
            postLoginRedirect: "/dashboard",
        });
    });

    it("validates the stored transaction and builds identity from ID token plus UserInfo", async () => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 300,
            scope: "openid Profile.read",
            claims: () => ({ sub: "subject-1" }),
        });
        oidc.fetchUserInfo.mockResolvedValue({
            email: "user@example.com",
            email_verified: true,
            name: "User",
        });

        await expect(
            completeBasisAuthFlow(
                new URL("https://untrusted.example/api/auth/basis/callback?code=code&state=state"),
                {
                    state: "state",
                    nonce: "nonce",
                    codeVerifier: "verifier",
                    startedAt: Date.now(),
                },
            ),
        ).resolves.toEqual({
            identity: {
                issuer: "https://auth.example.test",
                subject: "subject-1",
                email: "user@example.com",
                emailVerified: true,
                name: "User",
            },
            tokens: {
                accessToken: "access-token",
                expiresAt: expect.any(Number),
                refreshToken: "refresh-token",
            },
        });
        expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
            "configuration",
            new URL("https://hacks.example.test/api/auth/basis/callback?code=code&state=state"),
            {
                pkceCodeVerifier: "verifier",
                expectedState: "state",
                expectedNonce: "nonce",
            },
        );
        expect(oidc.fetchUserInfo).toHaveBeenCalledWith(
            "configuration",
            "access-token",
            "subject-1",
        );
    });

    it("accepts the validated ID token email verification claim when UserInfo omits it", async () => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 300,
            claims: () => ({
                sub: "subject-1",
                email: "user@example.com",
                email_verified: true,
            }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email: "user@example.com", name: "User" });

        const result = await completeBasisAuthFlow(
            new URL("https://hacks.example.test/api/auth/basis/callback?code=code&state=state"),
            {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            },
        );

        expect(result.identity.emailVerified).toBe(true);
    });

    it("does not apply an ID token email verification claim to a different UserInfo address", async () => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 300,
            claims: () => ({
                sub: "subject-1",
                email: "first@example.com",
                email_verified: true,
            }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email: "other@example.com", name: "User" });

        const result = await completeBasisAuthFlow(
            new URL("https://hacks.example.test/api/auth/basis/callback?code=code&state=state"),
            {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            },
        );

        expect(result.identity.emailVerified).toBe(false);
    });

    it("keeps email verification false when neither trusted identity response confirms it", async () => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 300,
            claims: () => ({ sub: "subject-1" }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email: "user@example.com", name: "User" });

        const result = await completeBasisAuthFlow(
            new URL("https://hacks.example.test/api/auth/basis/callback?code=code&state=state"),
            {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            },
        );

        expect(result.identity.emailVerified).toBe(false);
    });

    it("rejects expired transactions and unsafe post-login redirects", async () => {
        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test"), {}),
        ).rejects.toThrow("missing or expired");
        expect(sanitizePostLoginRedirect("/dashboard?tab=team")).toBe("/dashboard?tab=team");
        expect(sanitizePostLoginRedirect("https://evil.example")).toBeUndefined();
        expect(sanitizePostLoginRedirect("//evil.example")).toBeUndefined();
    });

    it.each([undefined, "", "dashboard", "//evil.example", "/\\evil.example/path"])(
        "rejects unsafe post-login redirect %s",
        (redirect) => {
            expect(sanitizePostLoginRedirect(redirect)).toBeUndefined();
        },
    );

    it("keeps a same-origin redirect path, query, and fragment", () => {
        expect(sanitizePostLoginRedirect("/dashboard?tab=team#members")).toBe(
            "/dashboard?tab=team#members",
        );
    });

    it("rejects a redirect value that fails URL parsing", () => {
        const uncoercibleValue = {
            startsWith: (prefix: string) => prefix === "/",
            toString: () => {
                throw new Error("cannot convert to URL");
            },
        };

        expect(sanitizePostLoginRedirect(uncoercibleValue as any)).toBeUndefined();
    });

    it("uses a case-insensitive ID token email match and omits a non-string display name", async () => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 300,
            claims: () => ({
                sub: "subject-1",
                email: " USER@example.com ",
                email_verified: true,
            }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email: "user@example.com", name: 9 });

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            }),
        ).resolves.toMatchObject({
            identity: { emailVerified: true, name: undefined },
        });
    });

    it.each([
        ["no subject", { claims: () => ({}) }],
        ["no access token", { access_token: undefined }],
        ["no refresh token", { refresh_token: undefined }],
        ["no claims", { claims: () => undefined }],
    ])("rejects a token response with %s", async (_label, overrides) => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            claims: () => ({ sub: "subject-1" }),
            ...overrides,
        });

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            }),
        ).rejects.toThrow("basis-auth did not return a complete token set");
        expect(oidc.fetchUserInfo).not.toHaveBeenCalled();
    });

    it.each([undefined, "", 42])("rejects UserInfo without a valid email (%s)", async (email) => {
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            claims: () => ({ sub: "subject-1" }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email });

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.now(),
            }),
        ).rejects.toThrow("basis-auth did not return an email address");
    });

    it("rejects transactions older than the ten-minute flow window", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:10:00.001Z"));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), {
                state: "state",
                nonce: "nonce",
                codeVerifier: "verifier",
                startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
            }),
        ).rejects.toThrow("missing or expired");
        expect(oidc.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it("accepts a transaction at the expiry boundary and normalizes a missing token lifetime", async () => {
        vi.useFakeTimers();
        const now = new Date("2026-01-01T00:10:00.000Z");
        vi.setSystemTime(now);
        oidc.authorizationCodeGrant.mockResolvedValue({
            access_token: "access-token",
            refresh_token: "refresh-token",
            claims: () => ({ sub: "subject-1" }),
        });
        oidc.fetchUserInfo.mockResolvedValue({ email: "user@example.com" });

        const result = await completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: now.getTime() - 10 * 60 * 1000,
        });

        expect(result.tokens.expiresAt).toBe(now.getTime() + 600_000);
        expect(result.identity.name).toBeUndefined();
    });

    it("propagates authorization and UserInfo failures from the OIDC provider", async () => {
        const transaction = {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: Date.now(),
        };
        const grantError = new Error("authorization grant failed");
        oidc.authorizationCodeGrant.mockRejectedValueOnce(grantError);
        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction),
        ).rejects.toBe(grantError);

        oidc.authorizationCodeGrant.mockResolvedValueOnce({
            access_token: "access-token",
            refresh_token: "refresh-token",
            claims: () => ({ sub: "subject-1" }),
        });
        const userInfoError = new Error("userinfo failed");
        oidc.fetchUserInfo.mockRejectedValueOnce(userInfoError);
        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction),
        ).rejects.toBe(userInfoError);
    });

    it("rejects incomplete refresh token sets and applies the one-second minimum lifetime", async () => {
        oidc.refreshTokenGrant
            .mockResolvedValueOnce({
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 0,
            })
            .mockResolvedValueOnce({ refresh_token: "refresh" });

        const before = Date.now();
        const tokens = await refreshBasisAuthTokens("old-refresh-token");
        expect(tokens).toMatchObject({ accessToken: "access", refreshToken: "refresh" });
        expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 1000);
        expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 1000);
        await expect(refreshBasisAuthTokens("old-refresh-token")).rejects.toThrow(
            "basis-auth did not return a complete token set",
        );
    });

    it("uses the 600-second fallback when a refresh response omits its lifetime", async () => {
        oidc.refreshTokenGrant.mockResolvedValue({
            access_token: "access",
            refresh_token: "refresh",
        });
        vi.useFakeTimers();
        const now = new Date("2026-02-01T00:00:00.000Z");
        vi.setSystemTime(now);

        await expect(refreshBasisAuthTokens("old-refresh-token")).resolves.toEqual({
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: now.getTime() + 600_000,
        });
    });

    it("revokes refresh tokens with the correct token type hint", async () => {
        await revokeBasisAuthToken("refresh-token");

        expect(oidc.tokenRevocation).toHaveBeenCalledWith("configuration", "refresh-token", {
            token_type_hint: "refresh_token",
        });
    });

    it("propagates token revocation errors", async () => {
        const failure = new Error("revocation failed");
        oidc.tokenRevocation.mockRejectedValueOnce(failure);

        await expect(revokeBasisAuthToken("refresh-token")).rejects.toBe(failure);
    });
});

describe("basis-auth session refresh", () => {
    const event = () => ({ context: {} }) as any;

    it("returns no session when the token cookie is absent", async () => {
        await expect(getFreshBasisAuthUserSession(event())).resolves.toBeUndefined();
        expect(oidc.refreshTokenGrant).not.toHaveBeenCalled();
    });

    it("returns a session without network access while its access token is fresh", async () => {
        const current = event();
        const tokens = {
            accessToken: "valid-access-token",
            accessTokenExpiresAt: Date.now() + 60_000,
            refreshToken: "refresh-token",
        };
        establishBasisAuthUserSession(current, 17, tokens);

        await expect(getFreshBasisAuthUserSession(current)).resolves.toEqual({
            userId: 17,
            tokens,
        });
        expect(oidc.refreshTokenGrant).not.toHaveBeenCalled();
    });

    it("rotates an expired access token and writes the refreshed token bundle", async () => {
        const current = event();
        establishBasisAuthUserSession(current, 17, {
            accessToken: "expired-access-token",
            accessTokenExpiresAt: Date.now(),
            refreshToken: "refresh-token",
        });
        oidc.refreshTokenGrant.mockResolvedValue({
            access_token: "new-access-token",
            refresh_token: "rotated-refresh-token",
            expires_in: 300,
        });

        const refreshed = await getFreshBasisAuthUserSession(current);

        expect(refreshed).toMatchObject({
            userId: 17,
            tokens: {
                accessToken: "new-access-token",
                refreshToken: "rotated-refresh-token",
                accessTokenExpiresAt: expect.any(Number),
            },
        });
        expect(cookiesFor(current).has(BASIS_AUTH_TOKEN_COOKIE)).toBe(true);
        expect(oidc.refreshTokenGrant).toHaveBeenCalledWith("configuration", "refresh-token");
    });

    it("shares one in-flight refresh between concurrent sessions with the same refresh token", async () => {
        const firstEvent = event();
        const secondEvent = event();
        const staleTokens = {
            accessToken: "expired-access-token",
            accessTokenExpiresAt: Date.now(),
            refreshToken: "shared-refresh-token",
        };
        establishBasisAuthUserSession(firstEvent, 17, staleTokens);
        establishBasisAuthUserSession(secondEvent, 18, staleTokens);

        let resolveRefresh!: (value: unknown) => void;
        oidc.refreshTokenGrant.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }),
        );
        const firstPending = getFreshBasisAuthUserSession(firstEvent);
        const secondPending = getFreshBasisAuthUserSession(secondEvent);
        await vi.waitFor(() => expect(oidc.refreshTokenGrant).toHaveBeenCalledTimes(1));
        resolveRefresh({
            access_token: "new-access-token",
            refresh_token: "rotated-refresh-token",
            expires_in: 300,
        });

        await expect(Promise.all([firstPending, secondPending])).resolves.toMatchObject([
            { userId: 17, tokens: { accessToken: "new-access-token" } },
            { userId: 18, tokens: { accessToken: "new-access-token" } },
        ]);
    });

    it("clears an expired session when refresh fails and permits a later retry", async () => {
        const current = event();
        establishBasisAuthUserSession(current, 17, {
            accessToken: "expired-access-token",
            accessTokenExpiresAt: Date.now(),
            refreshToken: "retry-refresh-token",
        });
        oidc.refreshTokenGrant
            .mockRejectedValueOnce(new Error("refresh failed"))
            .mockResolvedValueOnce({
                access_token: "recovered-access-token",
                refresh_token: "recovered-refresh-token",
                expires_in: 300,
            });

        await expect(getFreshBasisAuthUserSession(current)).resolves.toBeUndefined();
        expect(cookiesFor(current).has(BASIS_AUTH_TOKEN_COOKIE)).toBe(false);

        establishBasisAuthUserSession(current, 17, {
            accessToken: "expired-access-token",
            accessTokenExpiresAt: Date.now(),
            refreshToken: "retry-refresh-token",
        });
        await expect(getFreshBasisAuthUserSession(current)).resolves.toMatchObject({
            userId: 17,
            tokens: { accessToken: "recovered-access-token" },
        });
        expect(oidc.refreshTokenGrant).toHaveBeenCalledTimes(2);
    });
});
