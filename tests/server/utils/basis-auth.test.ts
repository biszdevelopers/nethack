import { beforeEach, describe, expect, it, vi } from "vitest";

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
    sanitizePostLoginRedirect,
} from "~~/server/utils/basis-auth";

beforeEach(() => {
    vi.clearAllMocks();
    process.env.BASIS_AUTH_ISSUER = "https://auth.example.test/";
    process.env.BASIS_AUTH_CLIENT_ID = "basishacks";
    process.env.BASIS_AUTH_CLIENT_SECRET = "secret";
    process.env.BASIS_AUTH_RESOURCE = "devconnect://nethack.bisz.dev";
    vi.stubGlobal("createError", (input: any) => Object.assign(new Error(input.message), input));
    oidc.discovery.mockResolvedValue("configuration");
});

describe("basis-auth authorization-code flow", () => {
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
});
