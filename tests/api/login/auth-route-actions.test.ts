import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockQueryState, setupNitroGlobals } from "../helpers";

const mocks = vi.hoisted(() => ({
    beginFlow: vi.fn(),
    completeFlow: vi.fn(),
    sanitizeRedirect: vi.fn((value?: string) =>
        value?.startsWith("/") && !value.startsWith("//") ? value : undefined,
    ),
    writeTransaction: vi.fn(),
    consumeTransaction: vi.fn(),
    linkUser: vi.fn(),
    establishSession: vi.fn(),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: any) => unknown) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/basis-auth", () => ({
    beginBasisAuthFlow: mocks.beginFlow,
    completeBasisAuthFlow: mocks.completeFlow,
    sanitizePostLoginRedirect: mocks.sanitizeRedirect,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    writeBasisAuthFlowTransaction: mocks.writeTransaction,
    consumeBasisAuthFlowTransaction: mocks.consumeTransaction,
    establishBasisAuthUserSession: mocks.establishSession,
}));
vi.mock("~~/server/utils/database/users", () => ({
    findOrLinkBasisAuthUser: mocks.linkUser,
}));

let loginHandler: (event: any) => Promise<unknown>;
let callbackHandler: (event: any) => Promise<unknown>;
const sendRedirect = vi.fn();
const createErrorMock = vi.fn((options: Record<string, unknown>) => {
    const error = new Error(
        String(options.message ?? options.statusMessage ?? "Error"),
    ) as Error & {
        statusCode?: number;
        statusMessage?: string;
    };
    error.statusCode = Number(options.statusCode ?? options.status ?? 500);
    error.statusMessage = String(options.statusMessage ?? options.message ?? "Error");
    return error;
});
const requestUrl = new URL("https://hacks.example.test/api/auth/basis/callback?code=valid");

function eventWithResponse() {
    return {
        context: {},
        node: { res: { setHeader: vi.fn() } },
    };
}

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("sendRedirect", sendRedirect);
    vi.stubGlobal("createError", createErrorMock);
    vi.stubGlobal(
        "getRequestURL",
        vi.fn(() => requestUrl),
    );
    loginHandler = (await import("~~/server/api/login.get")).default;
    callbackHandler = (await import("~~/server/api/auth/basis/callback.get")).default;
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createErrorMock.mockImplementation((options) => {
        const error = new Error(
            String(options.message ?? options.statusMessage ?? "Error"),
        ) as Error & {
            statusCode?: number;
            statusMessage?: string;
        };
        error.statusCode = Number(options.statusCode ?? options.status ?? 500);
        error.statusMessage = String(options.statusMessage ?? options.message ?? "Error");
        return error;
    });
    mockQueryState.value = {};
    sendRedirect.mockResolvedValue({ statusCode: 302 });
    mocks.sanitizeRedirect.mockImplementation((value?: string) =>
        value?.startsWith("/") && !value.startsWith("//") ? value : undefined,
    );
    mocks.beginFlow.mockResolvedValue({
        url: new URL("https://identity.example.test/authorize?state=opaque-state"),
        transaction: {
            state: "opaque-state",
            nonce: "opaque-nonce",
            codeVerifier: "pkce-verifier",
            startedAt: 500,
        },
    });
    mocks.consumeTransaction.mockReturnValue({
        state: "opaque-state",
        nonce: "opaque-nonce",
        codeVerifier: "pkce-verifier",
        startedAt: 500,
        postLoginRedirect: "/projects",
    });
    mocks.completeFlow.mockResolvedValue({
        identity: {
            issuer: "https://identity.example.test",
            subject: "subject-42",
            email: "participant@example.test",
        },
        tokens: {
            accessToken: "access-token",
            expiresAt: 123456,
            refreshToken: "refresh-token",
        },
    });
    mocks.linkUser.mockResolvedValue({ id: 42 });
});

describe("authentication route action patterns", () => {
    it("marks the login response private before saving a fresh OIDC transaction", async () => {
        mockQueryState.value = { redirect: "/dashboard" };
        const event = eventWithResponse();

        await loginHandler(event);

        expect(event.node.res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
        expect(mocks.sanitizeRedirect).toHaveBeenCalledWith("/dashboard");
        expect(mocks.beginFlow).toHaveBeenCalledWith("/dashboard");
        expect(mocks.writeTransaction).toHaveBeenCalledWith(event, {
            state: "opaque-state",
            nonce: "opaque-nonce",
            codeVerifier: "pkce-verifier",
            startedAt: 500,
        });
        expect(sendRedirect).toHaveBeenCalledWith(
            event,
            "https://identity.example.test/authorize?state=opaque-state",
            302,
        );
    });

    it("does not persist a login transaction when OIDC authorization setup fails", async () => {
        const failure = new Error("discovery unavailable");
        mocks.beginFlow.mockRejectedValueOnce(failure);

        await expect(loginHandler({ context: {} })).rejects.toBe(failure);
        expect(mocks.writeTransaction).not.toHaveBeenCalled();
        expect(sendRedirect).not.toHaveBeenCalled();
    });

    it("finishes callback login with a private response and a safe dashboard fallback", async () => {
        const event = eventWithResponse();
        mocks.consumeTransaction.mockReturnValueOnce({
            state: "opaque-state",
            nonce: "opaque-nonce",
            codeVerifier: "pkce-verifier",
            startedAt: 500,
        });

        await callbackHandler(event);

        expect(event.node.res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
        expect(mocks.consumeTransaction).toHaveBeenCalledWith(event);
        expect(mocks.completeFlow).toHaveBeenCalledWith(requestUrl, {
            state: "opaque-state",
            nonce: "opaque-nonce",
            codeVerifier: "pkce-verifier",
            startedAt: 500,
        });
        expect(mocks.linkUser).toHaveBeenCalledWith(event, {
            issuer: "https://identity.example.test",
            subject: "subject-42",
            email: "participant@example.test",
        });
        expect(mocks.establishSession).toHaveBeenCalledWith(event, 42, {
            accessToken: "access-token",
            accessTokenExpiresAt: 123456,
            refreshToken: "refresh-token",
        });
        expect(sendRedirect).toHaveBeenCalledWith(event, "/dashboard", 302);
    });

    it("keeps database-link failures generic and does not create an authenticated session", async () => {
        mocks.linkUser.mockRejectedValueOnce(new Error("database detail should not escape"));

        await expect(callbackHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "Authentication failed",
            message: "Unable to complete login. Please try again.",
        });
        expect(createErrorMock).toHaveBeenCalledWith({
            statusCode: 401,
            statusMessage: "Authentication failed",
            message: "Unable to complete login. Please try again.",
        });
        expect(mocks.establishSession).not.toHaveBeenCalled();
        expect(sendRedirect).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "basis-auth callback failed:",
            "database detail should not escape",
        );
    });

    it("normalizes non-Error callback failures without exposing their value", async () => {
        mocks.completeFlow.mockRejectedValueOnce({ secret: "provider response" });

        await expect(callbackHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 401,
            statusMessage: "Authentication failed",
            message: "Unable to complete login. Please try again.",
        });
        expect(createErrorMock).toHaveBeenCalledWith({
            statusCode: 401,
            statusMessage: "Authentication failed",
            message: "Unable to complete login. Please try again.",
        });
        expect(console.error).toHaveBeenCalledWith("basis-auth callback failed:", "unknown error");
        expect(mocks.establishSession).not.toHaveBeenCalled();
    });

    it("stops before code exchange if the one-time transaction cannot be consumed", async () => {
        const failure = new Error("transaction cookie unavailable");
        mocks.consumeTransaction.mockImplementationOnce(() => {
            throw failure;
        });

        await expect(callbackHandler({ context: {} })).rejects.toBe(failure);
        expect(mocks.completeFlow).not.toHaveBeenCalled();
        expect(mocks.linkUser).not.toHaveBeenCalled();
        expect(mocks.establishSession).not.toHaveBeenCalled();
    });
});
