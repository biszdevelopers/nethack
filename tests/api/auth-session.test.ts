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
    applyRateLimit: (handler: any) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
}));

let handler: any;

beforeAll(async () => {
    vi.stubGlobal("defineEventHandler", (value: any) => value);
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

describe("GET /api/auth/session", () => {
    it("returns a browser-safe session view without exposing either token", async () => {
        mocks.getFreshSession.mockResolvedValue({
            userId: 7,
            payload: { permissions: ["nethack.Chatbot.use"] },
            tokens: {
                accessToken: "access-token",
                accessTokenExpiresAt: 123456,
                refreshToken: "refresh-token",
            },
        });

        const result = await handler({ context: {} });

        expect(result).toEqual({
            user: { id: 7 },
            expiresAt: 123456,
            permissions: ["nethack.Chatbot.use"],
        });
        expect(JSON.stringify(result)).not.toContain("access-token");
        expect(JSON.stringify(result)).not.toContain("refresh-token");
    });

    it("grants the participant bundle when the local user row is missing", async () => {
        mocks.getFreshSession.mockResolvedValue({
            userId: 7,
            payload: { permissions: undefined },
            tokens: {
                accessToken: "access-token",
                accessTokenExpiresAt: 123456,
                refreshToken: "refresh-token",
            },
        });
        mocks.getUser.mockResolvedValue(undefined);

        await expect(handler({ context: {} })).resolves.toMatchObject({
            user: { id: 7 },
            permissions: expect.arrayContaining(["nethack.Profile.updateSelf"]),
        });
    });

    it("expands legacy grants for display-only client gating", async () => {
        mocks.getFreshSession.mockResolvedValue({
            userId: 7,
            payload: { permissions: ["participant"] },
            tokens: {
                accessToken: "access-token",
                accessTokenExpiresAt: 123456,
                refreshToken: "refresh-token",
            },
        });

        await expect(handler({ context: {} })).resolves.toMatchObject({
            permissions: expect.arrayContaining([
                "participant",
                "nethack.Profile.updateSelf",
                "nethack.Projects.submitOwn",
            ]),
        });
    });

    it("clears and rejects a missing cookie", async () => {
        mocks.getFreshSession.mockResolvedValue(undefined);

        await expect(handler({ context: {} })).rejects.toMatchObject({
            statusCode: 401,
            message: "Invalid access token",
        });
        expect(mocks.clearSession).toHaveBeenCalledOnce();
    });
});
