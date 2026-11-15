import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getFreshSession: vi.fn(),
    clearSession: vi.fn(),
    getUser: vi.fn(),
}));

vi.mock("~~/server/utils/basis-auth", () => ({
    getFreshBasisAuthUserSession: mocks.getFreshSession,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    clearBasisAuthUserSession: mocks.clearSession,
}));
vi.mock("~~/server/utils/database/users", () => ({
    getUser: mocks.getUser,
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
    mocks.getUser.mockImplementation(async (_event: unknown, id: number) => ({
        id,
        email: "user@example.com",
        is_admin: false,
    }));
});

describe("GET /api/auth/session action edges", () => {
    it("sets no-store on an HTTP response before returning the session view", async () => {
        mocks.getFreshSession.mockResolvedValue({
            userId: 42,
            payload: { permissions: [] },
            tokens: { accessToken: "secret-access", accessTokenExpiresAt: 1234 },
        });
        const setHeader = vi.fn();

        await expect(handler({ context: {}, node: { res: { setHeader } } })).resolves.toEqual({
            user: { id: 42 },
            expiresAt: 1234,
            permissions: expect.arrayContaining(["nethack.Profile.updateSelf"]),
        });
        expect(setHeader).toHaveBeenCalledWith("cache-control", "no-store");
    });

    it("propagates a rejected session check without loading local permissions", async () => {
        const error = Object.assign(new Error("Invalid access token"), { statusCode: 401 });
        mocks.getFreshSession.mockRejectedValue(error);

        await expect(handler({ context: {} })).rejects.toBe(error);
        expect(mocks.getUser).not.toHaveBeenCalled();
    });
});
