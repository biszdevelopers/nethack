import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
    verifyJwt: vi.fn(),
    endSessions: vi.fn(),
    revoke: vi.fn(),
}));

vi.mock("~~/server/utils/basis-auth-jwks", () => ({
    verifyBasisAuthJwt: mocks.verifyJwt,
}));

vi.mock("~~/server/utils/basis-auth-state", () => ({
    endBasisAuthSubjectSessions: mocks.endSessions,
    revokeAccessToken: mocks.revoke,
}));

import {
    applyBasisAuthAccessTokenRevocation,
    applyBasisAuthLogoutToken,
    handleBackchannelTest,
    sendBasisAuthWebhookProof,
} from "~~/server/utils/basis-auth-backchannel";

const RESOURCE = "devconnect://nethack.bisz.dev";
const RESOURCE_SECRET = "resource-secret";
const event = () => ({ context: {} }) as any;

beforeEach(() => {
    vi.clearAllMocks();
    process.env.BASIS_AUTH_ISSUER = "https://auth.example.test";
    process.env.BASIS_AUTH_CLIENT_ID = "basishacks";
    process.env.BASIS_AUTH_CLIENT_SECRET = "secret";
    process.env.BASIS_AUTH_RESOURCE = RESOURCE;
    process.env.BASIS_AUTH_INTERNAL_URL = "http://127.0.0.1:3001";
    process.env.BASIS_AUTH_RESOURCE_SECRET = RESOURCE_SECRET;
    vi.stubGlobal("createError", (input: any) => {
        const error = new Error(input.message);
        Object.assign(error, input);
        return error;
    });
});

describe("basis-auth webhook proof", () => {
    it("signs the challenge with the resource secret and target audience", async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await sendBasisAuthWebhookProof("nonce-value", "challenge-value");

        const expected = createHmac("sha256", RESOURCE_SECRET)
            .update("challenge-value", "utf8")
            .digest("hex");
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(String(url)).toBe("http://127.0.0.1:3001/internal/backchannel/validate");
        expect(init.headers).toMatchObject({
            authorization: `Bearer ${RESOURCE_SECRET}`,
            "x-basis-resource": encodeURIComponent(RESOURCE),
            "content-type": "application/json",
        });
        expect(JSON.parse(init.body as string)).toEqual({
            nonce: "nonce-value",
            challenge_hash: expected,
        });
    });

    it("answers the test action without waiting for the proof", () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 200 })),
        );

        expect(() =>
            handleBackchannelTest(
                new URLSearchParams({
                    action: "test",
                    nonce: "a".repeat(43),
                    challenge: "b".repeat(43),
                }),
            ),
        ).not.toThrow();
    });

    it("rejects a malformed challenge", () => {
        expect(() =>
            handleBackchannelTest(new URLSearchParams({ action: "test", nonce: "short" })),
        ).toThrow(/webhook challenge/);
    });
});

describe("basis-auth logout tokens", () => {
    it("ends the local sessions for the verified subject", async () => {
        mocks.verifyJwt.mockResolvedValue({
            sub: "subject-1",
            events: { "http://schemas.openid.net/event/backchannel-logout": {} },
        });

        await applyBasisAuthLogoutToken(event(), "logout-token");

        expect(mocks.verifyJwt).toHaveBeenCalledWith("logout-token", {
            typ: "logout+jwt",
            audience: RESOURCE,
        });
        expect(mocks.endSessions).toHaveBeenCalledWith(expect.anything(), "subject-1");
    });

    it("rejects a logout token without the backchannel event", async () => {
        mocks.verifyJwt.mockResolvedValue({ sub: "subject-1" });

        await expect(applyBasisAuthLogoutToken(event(), "logout-token")).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(mocks.endSessions).not.toHaveBeenCalled();
    });

    it("rejects a logout token that fails verification", async () => {
        mocks.verifyJwt.mockRejectedValue(new Error("bad signature"));

        await expect(applyBasisAuthLogoutToken(event(), "logout-token")).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(mocks.endSessions).not.toHaveBeenCalled();
    });
});

describe("basis-auth access-token revocations", () => {
    const form = (overrides: Record<string, string> = {}) =>
        new URLSearchParams({
            action: "revoke_access_token",
            jti: "jti-1",
            valid_after: "1000",
            revocation_token: "signed",
            ...overrides,
        });

    it("stores the signed revocation claims", async () => {
        mocks.verifyJwt.mockResolvedValue({
            access_token_jti: "jti-1",
            valid_after: 1000,
            access_token_expires_at: 4600,
        });

        await applyBasisAuthAccessTokenRevocation(event(), form());

        expect(mocks.verifyJwt).toHaveBeenCalledWith("signed", {
            typ: "at-revocation+jwt",
            audience: RESOURCE,
        });
        expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(), {
            jti: "jti-1",
            validAfter: 1000,
            expiresAt: 4600,
        });
    });

    it("rejects a revocation token that does not match the form fields", async () => {
        mocks.verifyJwt.mockResolvedValue({
            access_token_jti: "other-jti",
            valid_after: 1000,
        });

        await expect(applyBasisAuthAccessTokenRevocation(event(), form())).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(mocks.revoke).not.toHaveBeenCalled();
    });
});
