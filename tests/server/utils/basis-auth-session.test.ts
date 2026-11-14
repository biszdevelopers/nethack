import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = new Map<string, string>();
const setCookieMock = vi.fn((_event: unknown, name: string, value: string) => {
    cookies.set(name, value);
});
const deleteCookieMock = vi.fn((_event: unknown, name: string) => {
    cookies.delete(name);
});

let sessionUtils: typeof import("~~/server/utils/basis-auth-session");

beforeAll(async () => {
    vi.stubGlobal("getCookie", (_event: unknown, name: string) => cookies.get(name));
    vi.stubGlobal("setCookie", setCookieMock);
    vi.stubGlobal("deleteCookie", deleteCookieMock);
    vi.stubGlobal("createError", (input: any) => Object.assign(new Error(input.message), input));
    sessionUtils = await import("~~/server/utils/basis-auth-session");
});

beforeEach(() => {
    cookies.clear();
    vi.clearAllMocks();
    process.env.BASIS_AUTH_COOKIE_SECRET = "a-secure-cookie-secret-that-is-at-least-32-bytes";
});

const tokens = {
    accessToken: "access-token",
    accessTokenExpiresAt: Date.now() + 60_000,
    refreshToken: "refresh-token",
};

function sealTestPayload(value: unknown, purpose: "tokens" | "flow"): string {
    const secret = process.env.BASIS_AUTH_COOKIE_SECRET!;
    const key = createHash("sha256").update(`basishacks:basis-auth:${purpose}:${secret}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(value), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

describe("basis-auth encrypted cookies", () => {
    it("stores and restores the complete token bundle in an HTTP-only cookie", () => {
        const event = { context: {} } as any;

        sessionUtils.establishBasisAuthUserSession(event, 7, tokens);

        expect(setCookieMock).toHaveBeenCalledWith(
            event,
            sessionUtils.BASIS_AUTH_TOKEN_COOKIE,
            expect.stringMatching(/^v1\./),
            expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
        );
        expect(cookies.get(sessionUtils.BASIS_AUTH_TOKEN_COOKIE)).not.toContain("access-token");
        expect(sessionUtils.readBasisAuthUserSession(event)).toEqual({ userId: 7, tokens });
    });

    it("sets the token cookie for the root path with the 30-day lifetime", () => {
        const event = { context: {} } as any;

        sessionUtils.establishBasisAuthUserSession(event, 7, tokens);

        expect(setCookieMock).toHaveBeenCalledWith(
            event,
            sessionUtils.BASIS_AUTH_TOKEN_COOKIE,
            expect.any(String),
            {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            },
        );
    });

    it("marks auth cookies Secure in production", () => {
        const event = { context: {} } as any;
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        try {
            sessionUtils.establishBasisAuthUserSession(event, 7, tokens);
        } finally {
            if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = originalNodeEnv;
        }

        expect(setCookieMock).toHaveBeenCalledWith(
            event,
            sessionUtils.BASIS_AUTH_TOKEN_COOKIE,
            expect.any(String),
            expect.objectContaining({ secure: true }),
        );
    });

    it.each([undefined, "short", "é".repeat(15)])(
        "requires at least 32 UTF-8 bytes for the cookie secret (%s)",
        (secret) => {
            const event = { context: {} } as any;
            if (secret === undefined) delete process.env.BASIS_AUTH_COOKIE_SECRET;
            else process.env.BASIS_AUTH_COOKIE_SECRET = secret;

            expect(() => sessionUtils.establishBasisAuthUserSession(event, 7, tokens)).toThrow(
                "BASIS_AUTH_COOKIE_SECRET must be at least 32 bytes",
            );
        },
    );

    it("counts cookie-secret size as UTF-8 bytes", () => {
        const event = { context: {} } as any;
        process.env.BASIS_AUTH_COOKIE_SECRET = "界".repeat(11);

        expect(() => sessionUtils.establishBasisAuthUserSession(event, 7, tokens)).not.toThrow();
    });

    it("rejects a compressed token cookie that exceeds the browser-safe size limit", () => {
        const event = { context: {} } as any;
        const oversizedTokens = {
            accessToken: randomBytes(3000).toString("base64url"),
            accessTokenExpiresAt: Date.now() + 60_000,
            refreshToken: randomBytes(3000).toString("base64url"),
        };

        expect(() => sessionUtils.establishBasisAuthUserSession(event, 7, oversizedTokens)).toThrow(
            "basis-auth token cookie is too large",
        );
    });

    it("returns no session when the token cookie is absent", () => {
        expect(sessionUtils.readBasisAuthUserSession({ context: {} } as any)).toBeUndefined();
    });

    it.each(["v2.a.b.c", "v1..b.c", "v1.a..c", "v1.a.b.", "v1.a.b.c.extra"])(
        "rejects malformed encrypted token cookie framing %s",
        (value) => {
            const event = { context: {} } as any;
            cookies.set(sessionUtils.BASIS_AUTH_TOKEN_COOKIE, value);

            expect(sessionUtils.readBasisAuthUserSession(event)).toBeUndefined();
        },
    );

    it.each([
        null,
        "not-a-session",
        {},
        { userId: 1.5, tokens },
        { userId: 7 },
        { userId: 7, tokens: null },
        { userId: 7, tokens: { accessToken: 1, accessTokenExpiresAt: 1, refreshToken: "r" } },
        { userId: 7, tokens: { accessToken: "a", accessTokenExpiresAt: "1", refreshToken: "r" } },
        { userId: 7, tokens: { accessToken: "a", accessTokenExpiresAt: 1, refreshToken: 2 } },
    ])("rejects malformed encrypted session payload %#", (payload) => {
        const event = { context: {} } as any;
        cookies.set(sessionUtils.BASIS_AUTH_TOKEN_COOKIE, sealTestPayload(payload, "tokens"));

        expect(sessionUtils.readBasisAuthUserSession(event)).toBeUndefined();
    });

    it("rejects a tampered token cookie", () => {
        const event = { context: {} } as any;
        sessionUtils.establishBasisAuthUserSession(event, 7, tokens);
        cookies.set(
            sessionUtils.BASIS_AUTH_TOKEN_COOKIE,
            `${cookies.get(sessionUtils.BASIS_AUTH_TOKEN_COOKIE)}tampered`,
        );

        expect(sessionUtils.readBasisAuthUserSession(event)).toBeUndefined();
    });

    it("consumes the short-lived OAuth transaction cookie once", () => {
        const event = { context: {} } as any;
        const transaction = {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: Date.now(),
            postLoginRedirect: "/teams",
        };

        sessionUtils.writeBasisAuthFlowTransaction(event, transaction);

        expect(sessionUtils.consumeBasisAuthFlowTransaction(event)).toEqual(transaction);
        expect(sessionUtils.consumeBasisAuthFlowTransaction(event)).toEqual({});
        expect(deleteCookieMock).toHaveBeenCalledWith(event, sessionUtils.BASIS_AUTH_FLOW_COOKIE, {
            path: "/",
        });
    });

    it("sets the flow cookie with the ten-minute lifetime", () => {
        const event = { context: {} } as any;

        sessionUtils.writeBasisAuthFlowTransaction(event, {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: Date.now(),
        });

        expect(setCookieMock).toHaveBeenCalledWith(
            event,
            sessionUtils.BASIS_AUTH_FLOW_COOKIE,
            expect.any(String),
            expect.objectContaining({
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 10 * 60,
            }),
        );
    });

    it("discards malformed and tampered flow cookies while deleting them", () => {
        const event = { context: {} } as any;
        cookies.set(sessionUtils.BASIS_AUTH_FLOW_COOKIE, "v1.invalid-cookie");

        expect(sessionUtils.consumeBasisAuthFlowTransaction(event)).toEqual({});
        expect(cookies.has(sessionUtils.BASIS_AUTH_FLOW_COOKIE)).toBe(false);
        expect(deleteCookieMock).toHaveBeenCalledWith(event, sessionUtils.BASIS_AUTH_FLOW_COOKIE, {
            path: "/",
        });
    });

    it.each([null, "not-an-object"])(
        "does not return a non-object flow payload (%s)",
        (payload) => {
            const event = { context: {} } as any;
            cookies.set(sessionUtils.BASIS_AUTH_FLOW_COOKIE, sealTestPayload(payload, "flow"));

            expect(sessionUtils.consumeBasisAuthFlowTransaction(event)).toEqual({});
        },
    );

    it("does not accept a flow-purpose cookie as a user session", () => {
        const event = { context: {} } as any;
        sessionUtils.writeBasisAuthFlowTransaction(event, {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: Date.now(),
        });
        cookies.set(
            sessionUtils.BASIS_AUTH_TOKEN_COOKIE,
            cookies.get(sessionUtils.BASIS_AUTH_FLOW_COOKIE)!,
        );

        expect(sessionUtils.readBasisAuthUserSession(event)).toBeUndefined();
    });

    it("clears the token cookie", () => {
        const event = { context: {} } as any;
        sessionUtils.establishBasisAuthUserSession(event, 7, tokens);

        sessionUtils.clearBasisAuthUserSession(event);

        expect(sessionUtils.readBasisAuthUserSession(event)).toBeUndefined();
        expect(deleteCookieMock).toHaveBeenCalledWith(event, sessionUtils.BASIS_AUTH_TOKEN_COOKIE, {
            path: "/",
        });
    });
});
