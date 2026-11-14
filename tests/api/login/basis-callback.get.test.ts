import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../helpers";

const mocks = vi.hoisted(() => ({
    complete: vi.fn(),
    consumeFlow: vi.fn(),
    linkUser: vi.fn(),
    establishSession: vi.fn(),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: any) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/basis-auth", () => ({
    completeBasisAuthFlow: mocks.complete,
    sanitizePostLoginRedirect: (value?: string) => value,
}));
vi.mock("~~/server/utils/database/users", () => ({
    findOrLinkBasisAuthUser: mocks.linkUser,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    consumeBasisAuthFlowTransaction: mocks.consumeFlow,
    establishBasisAuthUserSession: mocks.establishSession,
}));

let handler: any;
const sendRedirectMock = vi.fn();

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("sendRedirect", sendRedirectMock);
    vi.stubGlobal(
        "getRequestURL",
        vi.fn(() => new URL("https://hacks.example.test/api/auth/basis/callback?code=code")),
    );
    handler = (await import("~~/server/api/auth/basis/callback.get")).default;
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeFlow.mockReturnValue({
        state: "state",
        nonce: "nonce",
        codeVerifier: "verifier",
        startedAt: 123,
        postLoginRedirect: "/teams",
    });
    mocks.complete.mockResolvedValue({
        identity: {
            issuer: "https://auth.example.test",
            subject: "subject-1",
            email: "user@example.com",
        },
        tokens: {
            accessToken: "access-token",
            expiresAt: 123456,
            refreshToken: "refresh-token",
            scopes: ["Profile.all"],
        },
    });
    mocks.linkUser.mockResolvedValue({ id: 17 });
});

describe("GET /api/auth/basis/callback", () => {
    it("clears the transaction, creates the existing local session, and redirects safely", async () => {
        await handler({ context: {} });

        expect(mocks.consumeFlow).toHaveBeenCalledOnce();
        expect(mocks.complete).toHaveBeenCalledWith(expect.any(URL), {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: 123,
            postLoginRedirect: "/teams",
        });
        expect(mocks.establishSession).toHaveBeenCalledWith(expect.anything(), 17, {
            accessToken: "access-token",
            accessTokenExpiresAt: 123456,
            refreshToken: "refresh-token",
        });
        expect(sendRedirectMock).toHaveBeenCalledWith(expect.anything(), "/teams", 302);
    });

    it("fails closed without creating a session when state, nonce, or PKCE validation fails", async () => {
        mocks.complete.mockRejectedValue(new Error("state mismatch"));

        await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 401 });
        expect(mocks.consumeFlow).toHaveBeenCalledOnce();
        expect(mocks.establishSession).not.toHaveBeenCalled();
    });

    it("fails closed if the atomic local session cannot be established", async () => {
        mocks.establishSession.mockImplementationOnce(() => {
            throw new Error("cookie unavailable");
        });

        await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 401 });
    });
});
