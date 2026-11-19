import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockQueryState, resetMockState, setupNitroGlobals } from "../helpers";

const { beginFlowMock, sanitizeMock, writeFlowMock, readSessionMock } = vi.hoisted(() => ({
    beginFlowMock: vi.fn(),
    sanitizeMock: vi.fn((value?: string) =>
        value?.startsWith("/") && !value.startsWith("//") ? value : undefined,
    ),
    writeFlowMock: vi.fn(),
    readSessionMock: vi.fn(),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: any) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
}));

vi.mock("~~/server/utils/basis-auth", () => ({
    beginBasisAuthFlow: beginFlowMock,
    sanitizePostLoginRedirect: sanitizeMock,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    writeBasisAuthFlowTransaction: writeFlowMock,
    readBasisAuthUserSession: readSessionMock,
}));

let handler: any;
const sendRedirectMock = vi.fn();

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("sendRedirect", sendRedirectMock);
    handler = (await import("~~/server/api/login.get")).default;
});

beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    beginFlowMock.mockResolvedValue({
        url: new URL("https://auth.example.test/oauth/authorize?state=state"),
        transaction: {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: 123,
        },
    });
});

describe("GET /api/login", () => {
    it("stores the encrypted login transaction before redirecting to basis-auth", async () => {
        mockQueryState.value = { redirect: "/dashboard" };
        await handler({ context: {} });

        expect(sanitizeMock).toHaveBeenCalledWith("/dashboard");
        expect(beginFlowMock).toHaveBeenCalledWith("/dashboard", undefined);
        expect(writeFlowMock).toHaveBeenCalledWith(expect.anything(), {
            state: "state",
            nonce: "nonce",
            codeVerifier: "verifier",
            startedAt: 123,
        });
        expect(sendRedirectMock).toHaveBeenCalledWith(
            expect.anything(),
            "https://auth.example.test/oauth/authorize?state=state",
            302,
        );
    });

    it.each(["https://evil.example/phish", "//evil.example/phish"])(
        "does not preserve unsafe redirects: %s",
        async (redirect) => {
            mockQueryState.value = { redirect };
            await handler({ context: {} });
            expect(beginFlowMock).toHaveBeenCalledWith(undefined, undefined);
        },
    );

    it("binds the flow to the account that is already signed in", async () => {
        readSessionMock.mockReturnValueOnce({ userId: 9 });

        await handler({ context: {} });

        expect(beginFlowMock).toHaveBeenCalledWith(undefined, 9);
    });
});
