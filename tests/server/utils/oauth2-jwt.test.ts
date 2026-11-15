import { beforeEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock, createRemoteJWKSetMock, getUserBySubjectMock } = vi.hoisted(() => ({
    jwtVerifyMock: vi.fn(),
    createRemoteJWKSetMock: vi.fn(() => "jwks"),
    getUserBySubjectMock: vi.fn(),
}));

vi.mock("jose", () => ({
    createRemoteJWKSet: createRemoteJWKSetMock,
    jwtVerify: jwtVerifyMock,
}));

vi.mock("~~/server/utils/basis-auth", () => ({
    getBasisAuthConfig: () => ({
        issuer: "https://auth.example.test",
        clientId: "basishacks",
        clientSecret: "secret",
        resource: "devconnect://nethack.bisz.dev",
    }),
    getFreshBasisAuthUserSession: vi.fn(),
}));

vi.mock("~~/server/utils/database/users", () => ({
    getUserByBasisAuthSubject: getUserBySubjectMock,
}));

import {
    extractBearerToken,
    resolveOAuth2User,
    verifyAccessToken,
    verifyOAuth2JWT,
} from "~~/server/utils/oauth2-jwt";
import { getFreshBasisAuthUserSession } from "~~/server/utils/basis-auth";

const event = () => ({ context: {} }) as any;
const claims = {
    sub: "user-1",
    client_id: "portal",
    scope: "chat.readwrite",
    permissions: ["Users.read"],
    jti: "token-id",
    iat: 100,
    exp: 200,
    iss: "https://auth.example.test",
    aud: "devconnect://nethack.bisz.dev",
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("createError", (input: any) => {
        const error = new Error(input.message);
        Object.assign(error, input);
        return error;
    });
    vi.stubGlobal("getHeader", vi.fn());
});

describe("basis-auth access tokens", () => {
    it("validates RS256, the exact issuer, resource audience, type, expiry, and claims", async () => {
        jwtVerifyMock.mockResolvedValue({
            payload: claims,
        });

        await expect(verifyAccessToken("token")).resolves.toMatchObject({ sub: "user-1" });
        expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
            new URL("https://auth.example.test/oauth/jwks"),
        );
        expect(jwtVerifyMock).toHaveBeenCalledWith("token", "jwks", {
            algorithms: ["RS256"],
            issuer: "https://auth.example.test",
            audience: "devconnect://nethack.bisz.dev",
            typ: "at+jwt",
        });
    });

    it.each([
        { client_id: "portal", scope: "chat.readwrite" },
        { sub: "user-1", scope: "chat.readwrite" },
        { sub: "user-1", client_id: "portal" },
    ])("rejects an access token missing required claims", async (payload) => {
        jwtVerifyMock.mockResolvedValue({ payload });
        await expect(verifyAccessToken("token")).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "invalid_token",
        });
    });

    it("rejects invalid signatures, issuers, audiences, types, and expired tokens", async () => {
        jwtVerifyMock.mockRejectedValue(new Error("JWT verification failed"));
        await expect(verifyAccessToken("token")).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects an empty token before attempting configuration or signature checks", async () => {
        await expect(verifyAccessToken("")).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "invalid_token",
            message: "Empty access token",
        });
        expect(jwtVerifyMock).not.toHaveBeenCalled();
    });

    it("maps the stable issuer and subject to the local user", async () => {
        const user = { id: 42 };
        getUserBySubjectMock.mockResolvedValue(user);
        await expect(resolveOAuth2User(event(), { sub: "user-1" })).resolves.toBe(user);
        expect(getUserBySubjectMock).toHaveBeenCalledWith(
            expect.anything(),
            "https://auth.example.test",
            "user-1",
        );
    });

    it("rejects a token without a subject before looking up a local user", async () => {
        await expect(resolveOAuth2User(event(), {})).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "invalid_token",
        });
        expect(getUserBySubjectMock).not.toHaveBeenCalled();
    });

    it("returns not found when the basis-auth identity has no local user", async () => {
        getUserBySubjectMock.mockResolvedValue(undefined);
        await expect(resolveOAuth2User(event(), { sub: "missing-user" })).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found",
        });
    });
});

describe("OAuth2 bearer parsing", () => {
    it("extracts case-insensitive bearer tokens and rejects malformed headers", () => {
        vi.mocked(getHeader).mockReturnValue("bEaReR token");
        expect(extractBearerToken(event())).toBe("token");
        vi.mocked(getHeader).mockReturnValue("Basic token");
        expect(() => extractBearerToken(event())).toThrow();
    });

    it("rejects a bearer scheme without a token", () => {
        vi.mocked(getHeader).mockReturnValue("Bearer   ");
        expect(() => extractBearerToken(event())).toThrow("Empty access token");
    });

    it("verifies bearer tokens when the request carries an authorization header", async () => {
        vi.mocked(getHeader).mockReturnValue("Bearer signed-token");
        jwtVerifyMock.mockResolvedValue({ payload: claims });

        await expect(verifyOAuth2JWT(event())).resolves.toMatchObject({ sub: "user-1" });
        expect(getFreshBasisAuthUserSession).not.toHaveBeenCalled();
        expect(jwtVerifyMock).toHaveBeenCalledWith(
            "signed-token",
            "jwks",
            expect.objectContaining({ typ: "at+jwt" }),
        );
    });

    it("verifies the fresh session cookie token when authorization is absent", async () => {
        vi.mocked(getHeader).mockReturnValue(undefined);
        vi.mocked(getFreshBasisAuthUserSession).mockResolvedValue({
            userId: 42,
            tokens: {
                accessToken: "cookie-token",
                accessTokenExpiresAt: Date.now() + 60_000,
                refreshToken: "refresh-token",
            },
        } as any);
        jwtVerifyMock.mockResolvedValue({ payload: claims });

        await expect(verifyOAuth2JWT(event())).resolves.toMatchObject({ sub: "user-1" });
        expect(jwtVerifyMock).toHaveBeenCalledWith(
            "cookie-token",
            "jwks",
            expect.objectContaining({ typ: "at+jwt" }),
        );
    });

    it("rejects requests without an authorization header or active session", async () => {
        vi.mocked(getHeader).mockReturnValue(undefined);
        vi.mocked(getFreshBasisAuthUserSession).mockResolvedValue(undefined);

        await expect(verifyOAuth2JWT(event())).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "invalid_token",
            message: "Missing or expired basis-auth token cookie",
        });
        expect(jwtVerifyMock).not.toHaveBeenCalled();
    });
});
