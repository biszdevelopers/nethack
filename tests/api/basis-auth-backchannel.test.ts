import { createHmac } from "node:crypto";
import { createApp, defineEventHandler, toWebHandler } from "h3";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAccessToken } from "~~/server/utils/basis-auth-jwt";
import { getBasisAuthConfig } from "~~/server/utils/basis-auth";

const mocks = vi.hoisted(() => ({
    jwks: vi.fn(),
    revoke: vi.fn(),
    logout: vi.fn(),
    isRevoked: vi.fn(),
}));
vi.mock("jose", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jose")>()),
    createRemoteJWKSet: mocks.jwks,
}));
vi.mock("~~/server/utils/database/basis-auth-revocations", () => ({
    recordBasisAccessTokenRevocation: mocks.revoke,
    recordBasisSubjectLogout: mocks.logout,
    isBasisCredentialRevoked: mocks.isRevoked,
}));

const issuer = "https://backchannel.example.test";
const audience = "devconnect://nethack.bisz.dev";
const eventName = "http://schemas.openid.net/event/backchannel-logout";
const db = {};
const secret = "test-resource-secret";
const now = 1_800_000_000;
const revocationClaims = {
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 120,
    access_token_jti: "old-access-token",
    valid_after: now + 60,
    access_token_expires_at: now + 7200,
};
const logoutClaims = {
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 120,
    sub: "test-subject",
    jti: "logout-id",
    events: { [eventName]: {} },
};
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let handle: ReturnType<typeof toWebHandler>;
let background: Promise<unknown>[];

beforeAll(async () => {
    const [keys, wrongKeys] = await Promise.all([
        generateKeyPair("RS256"),
        generateKeyPair("RS256"),
    ]);
    signingKey = keys.privateKey;
    otherKey = wrongKeys.privateKey;
    mocks.jwks.mockReturnValue(createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
    vi.stubGlobal("defineEventHandler", defineEventHandler);
    const { default: handler } = await import("~~/server/api/auth/backchannel-logout.post");
    const { default: requestSecurity } = await import("~~/server/middleware/00.request-security");
    handle = toWebHandler(
        createApp({ debug: false })
            .use(requestSecurity)
            .use(
                defineEventHandler((event) => {
                    Object.assign(event.context, { drizzle: db });
                    event.waitUntil = (promise) => {
                        expect(event.node.res.writableEnded).toBe(true);
                        background.push(promise);
                    };
                    return handler(event);
                }),
            ),
    );
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now * 1000);
    vi.stubEnv("BASIS_AUTH_ISSUER", issuer);
    vi.stubEnv("BASIS_AUTH_RESOURCE", audience);
    vi.stubEnv("BASIS_AUTH_CLIENT_ID", "test-client");
    vi.stubEnv("BASIS_AUTH_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("BASIS_AUTH_INTERNAL_URL", "http://localhost:3001");
    vi.stubEnv("BASIS_AUTH_RESOURCE_SECRET", secret);
    vi.stubEnv("BASIS_AUTH_ACCESS_TOKEN_LIFETIME_SECONDS", undefined);
    mocks.revoke.mockReset().mockResolvedValue(undefined);
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.isRevoked.mockReset().mockResolvedValue(false);
    background = [];
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function sign(claims: JWTPayload, typ: string, key = signingKey) {
    return new SignJWT(claims).setProtectedHeader({ alg: "RS256", typ }).sign(key);
}

function post(body: Record<string, string> | string) {
    return handle(
        new Request("http://localhost/api/auth/backchannel-logout", {
            method: "POST",
            body: typeof body === "string" ? body : new URLSearchParams(body),
        }),
    );
}

function revoke(revocation_token: string, form: Record<string, string> = {}) {
    return post({
        action: "revoke_access_token",
        jti: revocationClaims.access_token_jti,
        valid_after: String(revocationClaims.valid_after),
        revocation_token,
        ...form,
    });
}

describe("POST /api/auth/backchannel-logout", () => {
    it("acknowledges before submitting a case-preserving proof to the configured listener", async () => {
        const nonce = "aA_" + "B".repeat(40);
        const challenge = "Cc-" + "D".repeat(40);
        const proof = Promise.withResolvers<Response>();
        const fetchProof = vi.fn(() => proof.promise);
        vi.stubGlobal("fetch", fetchProof);
        expect((await post({ action: "test", nonce, challenge })).status).toBe(202);
        expect(background).toHaveLength(1);
        expect(fetchProof).toHaveBeenCalledWith(
            new URL("http://localhost:3001/internal/backchannel/validate"),
            expect.objectContaining({
                method: "POST",
                headers: {
                    Authorization: `Bearer ${secret}`,
                    "X-Basis-Resource": encodeURIComponent(audience),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    nonce,
                    challenge_hash: createHmac("sha256", secret).update(challenge).digest("hex"),
                }),
                signal: expect.any(AbortSignal),
                redirect: "error",
            }),
        );
        proof.resolve(Response.json({ status: "successful" }));
        await Promise.all(background);
    });

    it("rejects unsupported content types and malformed or duplicate form fields", async () => {
        expect((await post("{}")).status).toBe(415);
        expect((await post({ action: "test", nonce: "x", challenge: "y" })).status).toBe(400);
        expect(
            (
                await handle(
                    new Request("http://localhost/api/auth/backchannel-logout", {
                        method: "POST",
                        body: new URLSearchParams("logout_token=first&logout_token=second"),
                    }),
                )
            ).status,
        ).toBe(400);
        expect(background).toHaveLength(0);
    });

    it("reports unavailable proof configuration before acknowledging the challenge", async () => {
        vi.stubEnv("BASIS_AUTH_INTERNAL_URL", undefined);
        expect(
            (await post({ action: "test", nonce: "a".repeat(43), challenge: "b".repeat(43) }))
                .status,
        ).toBe(503);
        expect(background).toHaveLength(0);
    });

    it("acknowledges even when Basis Auth rejects the proof or cannot be reached", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            vi.stubGlobal(
                "fetch",
                vi
                    .fn()
                    .mockResolvedValueOnce(new Response(null, { status: 401 }))
                    .mockRejectedValueOnce(new Error("credential-bearing data")),
            );
            const form = { action: "test", nonce: "a".repeat(43), challenge: "b".repeat(43) };
            expect((await post(form)).status).toBe(202);
            expect((await post(form)).status).toBe(202);
            await Promise.all(background);
            expect(warn.mock.calls).toEqual([
                ["[Basis Auth] Backchannel proof rejected"],
                ["[Basis Auth] Backchannel proof submission failed"],
            ]);
        } finally {
            warn.mockRestore();
        }
    });

    it("allows a verified expired cookie token only for refresh and still checks revocation", async () => {
        const event = { context: { drizzle: db } } as Parameters<typeof verifyAccessToken>[0];
        const claims = {
            iss: issuer,
            aud: audience,
            iat: now - 60,
            exp: now,
            jti: "expired",
            sub: "subject",
            scope: "openid",
            client_id: "test-client",
        };
        const token = await sign(claims, "at+jwt");
        const options = { allowExpiredForRefresh: true };
        await expect(verifyAccessToken(event, token, getBasisAuthConfig())).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid access token",
        });
        await expect(
            verifyAccessToken(event, token, getBasisAuthConfig(), options),
        ).resolves.toMatchObject(claims);
        mocks.isRevoked.mockResolvedValueOnce(true);
        await expect(
            verifyAccessToken(event, token, getBasisAuthConfig(), options),
        ).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid access token",
        });
        const badSignature = await sign(claims, "at+jwt", otherKey);
        await expect(
            verifyAccessToken(event, badSignature, getBasisAuthConfig(), options),
        ).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid access token",
        });
    });

    it("persists signed revocations with retention through expirations beyond one hour", async () => {
        const result = await revoke(await sign(revocationClaims, "at-revocation+jwt"));
        expect(result.status).toBe(204);
        expect(mocks.revoke).toHaveBeenCalledWith(
            db,
            issuer,
            "old-access-token",
            now + 60,
            now + 7200,
        );
    });

    it.each([
        ["default", undefined, 3600],
        ["longer", "5400", 5400],
    ])("retains legacy tokens through the %s lifetime", async (_label, lifetime, retention) => {
        vi.stubEnv("BASIS_AUTH_ACCESS_TOKEN_LIFETIME_SECONDS", lifetime);
        const token = await sign(
            { ...revocationClaims, access_token_expires_at: null },
            "at-revocation+jwt",
        );
        expect((await revoke(token)).status).toBe(204);
        expect(mocks.revoke).toHaveBeenCalledWith(
            db,
            issuer,
            "old-access-token",
            now + 60,
            now + retention,
        );
    });

    it.each([
        ["invalid signature", {}, "at-revocation+jwt", true],
        ["wrong type", {}, "at+jwt", false],
        ["wrong issuer", { iss: "https://wrong.example.test" }, "at-revocation+jwt", false],
        ["wrong audience", { aud: "wrong" }, "at-revocation+jwt", false],
        ["absent expiration", { exp: undefined }, "at-revocation+jwt", false],
        ["expired token", { exp: now }, "at-revocation+jwt", false],
        [
            "missing original expiration",
            { access_token_expires_at: undefined },
            "at-revocation+jwt",
            false,
        ],
        [
            "invalid original expiration",
            { access_token_expires_at: "7200" },
            "at-revocation+jwt",
            false,
        ],
    ] as const)("rejects revocation with %s", async (_reason, claims, typ, wrongKey) => {
        const token = await sign(
            { ...revocationClaims, ...claims },
            typ,
            wrongKey ? otherKey : signingKey,
        );
        expect((await revoke(token)).status).toBe(400);
        expect(mocks.revoke).not.toHaveBeenCalled();
    });

    it.each([{ jti: "different" }, { valid_after: String(now + 61) }])(
        "rejects form fields that differ from signed revocation claims",
        async (form) => {
            expect(
                (await revoke(await sign(revocationClaims, "at-revocation+jwt"), form)).status,
            ).toBe(400);
            expect(mocks.revoke).not.toHaveBeenCalled();
        },
    );

    it("records a subject logout with its signed issue time", async () => {
        const token = await sign(logoutClaims, "logout+jwt");
        expect((await post({ logout_token: token })).status).toBe(204);
        expect(mocks.logout).toHaveBeenCalledWith(db, issuer, "test-subject", now);
    });

    it.each([
        { sub: undefined },
        { iat: undefined },
        { iat: now + 1 },
        { jti: undefined },
        { events: {} },
        { exp: undefined },
        { exp: now },
        { aud: "wrong" },
        { iss: "wrong" },
    ])("rejects invalid subject logout claims", async (claims) => {
        expect(
            (await post({ logout_token: await sign({ ...logoutClaims, ...claims }, "logout+jwt") }))
                .status,
        ).toBe(400);
        expect(mocks.logout).not.toHaveBeenCalled();
    });

    it("returns a retryable error when persistence fails", async () => {
        mocks.revoke.mockRejectedValue(new Error("database failure"));
        expect((await revoke(await sign(revocationClaims, "at-revocation+jwt"))).status).toBe(503);
    });
});
