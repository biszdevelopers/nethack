import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getFreshSession: vi.fn(),
    clearSession: vi.fn(),
    verifyAccessToken: vi.fn(),
}));

vi.mock("~~/server/utils/basis-auth", () => ({
    getFreshBasisAuthUserSession: mocks.getFreshSession,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    clearBasisAuthUserSession: mocks.clearSession,
}));
vi.mock("~~/server/utils/oauth2-jwt", () => ({
    verifyAccessToken: mocks.verifyAccessToken,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
}));

let handler: any;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (value: (event: unknown) => unknown) => value);
    handler = (await import("~~/server/api/auth/session.get")).default;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/auth/session action edges", () => {
    it("sets no-store on an HTTP response before returning the session view", async () => {
        mocks.getFreshSession.mockResolvedValue({
            userId: 42,
            tokens: { accessToken: "secret-access", accessTokenExpiresAt: 1234 },
        });
        mocks.verifyAccessToken.mockResolvedValue({ permissions: [] });
        const setHeader = vi.fn();

        await expect(handler({ context: {}, node: { res: { setHeader } } })).resolves.toEqual({
            user: { id: 42 },
            expiresAt: 1234,
            permissions: [],
        });
        expect(setHeader).toHaveBeenCalledWith("cache-control", "no-store");
    });

    it("clears the session and propagates a rejected access-token verification", async () => {
        const error = Object.assign(new Error("Token expired"), { statusCode: 401 });
        mocks.getFreshSession.mockResolvedValue({
            userId: 42,
            tokens: { accessToken: "expired-access", accessTokenExpiresAt: 1234 },
        });
        mocks.verifyAccessToken.mockRejectedValue(error);

        await expect(handler({ context: {} })).rejects.toBe(error);
        expect(mocks.clearSession).toHaveBeenCalledOnce();
    });
});
