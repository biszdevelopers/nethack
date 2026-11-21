import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    verifyOAuth2JWT: vi.fn(),
    resolveOAuth2User: vi.fn(),
    readBasisAuthUserSession: vi.fn(),
    clearBasisAuthUserSession: vi.fn(),
}));

vi.mock("~~/server/utils/oauth2-jwt", () => ({
    verifyOAuth2JWT: mocks.verifyOAuth2JWT,
    resolveOAuth2User: mocks.resolveOAuth2User,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    readBasisAuthUserSession: mocks.readBasisAuthUserSession,
    clearBasisAuthUserSession: mocks.clearBasisAuthUserSession,
}));

import { optionalUser, requireUser } from "~~/server/utils/auth";

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("createError", (input: any) => Object.assign(new Error(input.message), input));
    vi.stubGlobal("getHeader", () => undefined);
    mocks.verifyOAuth2JWT.mockResolvedValue({ sub: "subject-1", permissions: [] });
    mocks.resolveOAuth2User.mockResolvedValue({ id: 5, is_admin: 0 });
    mocks.readBasisAuthUserSession.mockReturnValue(undefined);
});

const event = () => ({ context: {} }) as any;

describe("requireUser without a cached OAuth2 context", () => {
    it("verifies the bearer token and resolves the user", async () => {
        const eventObject = event();

        await expect(requireUser(eventObject)).resolves.toMatchObject({ id: 5 });

        expect(mocks.verifyOAuth2JWT).toHaveBeenCalledWith(eventObject);
        expect(mocks.resolveOAuth2User).toHaveBeenCalledOnce();
        expect(eventObject.context.oauth2).toMatchObject({ user: { id: 5 } });
    });

    it("allows a second tokenless read with no required permission", async () => {
        const eventObject = event();

        await expect(requireUser(eventObject)).resolves.toMatchObject({ id: 5 });
        expect(eventObject.context.oauth2?.payload).toMatchObject({ sub: "subject-1" });
    });

    it("reuses a cached OAuth2 context and accepts a granted permission", async () => {
        const eventObject = event();
        const user = { id: 5, is_admin: 0 };
        eventObject.context.oauth2 = {
            payload: { sub: "subject-1", permissions: ["nethack.Profile.updateSelf"] },
            user,
        };

        await expect(requireUser(eventObject, "nethack.Profile.updateSelf")).resolves.toMatchObject(
            { id: 5 },
        );
        expect(mocks.verifyOAuth2JWT).not.toHaveBeenCalled();
        expect(mocks.resolveOAuth2User).not.toHaveBeenCalled();
    });

    it("rejects a missing permission with 403", async () => {
        await expect(requireUser(event(), "nethack.all")).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: "insufficient_permission",
        });
    });

    it("reuses a cached payload while resolving the user", async () => {
        const eventObject = event();
        eventObject.context.oauth2 = {
            payload: { sub: "subject-1", permissions: [] },
        };

        await expect(requireUser(eventObject)).resolves.toMatchObject({ id: 5 });
        expect(mocks.verifyOAuth2JWT).not.toHaveBeenCalled();
        expect(mocks.resolveOAuth2User).toHaveBeenCalledOnce();
    });

    it("reuses a cached user while verifying the payload", async () => {
        const eventObject = event();
        eventObject.context.oauth2 = { user: { id: 5, is_admin: 0 } };

        await expect(requireUser(eventObject)).resolves.toMatchObject({ id: 5 });
        expect(mocks.verifyOAuth2JWT).toHaveBeenCalledOnce();
        expect(mocks.resolveOAuth2User).not.toHaveBeenCalled();
    });

    it("grants nethack.all to a local administrator without a granular grant", async () => {
        mocks.resolveOAuth2User.mockResolvedValue({ id: 5, is_admin: 1 });

        await expect(requireUser(event(), "nethack.all")).resolves.toMatchObject({ id: 5 });
    });
});

describe("optionalUser stale sessions", () => {
    it("clears a stale cookie session and stays anonymous", async () => {
        mocks.readBasisAuthUserSession.mockReturnValue({ userId: 5 });
        mocks.verifyOAuth2JWT.mockRejectedValueOnce(
            Object.assign(new Error("expired"), { statusCode: 401 }),
        );

        await expect(optionalUser(event())).resolves.toBeUndefined();
        expect(mocks.clearBasisAuthUserSession).toHaveBeenCalledOnce();
    });

    it("propagates a non-401 failure for a cookie session", async () => {
        mocks.readBasisAuthUserSession.mockReturnValue({ userId: 5 });
        mocks.verifyOAuth2JWT.mockRejectedValueOnce(
            Object.assign(new Error("offline"), { statusCode: 503 }),
        );

        await expect(optionalUser(event())).rejects.toThrow("offline");
        expect(mocks.clearBasisAuthUserSession).not.toHaveBeenCalled();
    });

    it("propagates bearer failures instead of clearing the session", async () => {
        vi.stubGlobal("getHeader", () => "Bearer token");
        mocks.verifyOAuth2JWT.mockRejectedValueOnce(
            Object.assign(new Error("invalid token"), { statusCode: 401 }),
        );

        await expect(optionalUser(event())).rejects.toThrow("invalid token");
        expect(mocks.clearBasisAuthUserSession).not.toHaveBeenCalled();
    });
});
