import { beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    resolve: vi.fn(),
    readSession: vi.fn(),
}));

vi.mock("~~/server/utils/oauth2-jwt", () => ({
    verifyOAuth2JWT: mocks.verify,
    resolveOAuth2User: mocks.resolve,
}));

vi.mock("~~/server/utils/basis-auth-session", () => ({
    readBasisAuthUserSession: mocks.readSession,
}));

import { optionalUser, requireUser } from "~~/server/utils/auth";

const event = () => ({ context: {} }) as any;
const payload = {
    iss: "https://auth.example.test",
    sub: "subject-1",
    aud: "devconnect://nethack.bisz.dev",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    type: "access_token" as const,
    client_id: "basishacks",
    scope: "openid nethack.access",
    permissions: [NethackPermissions.Teams.list],
};
const user = { id: 7, auth_issuer: payload.iss, auth_subject: payload.sub };

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("createError", (input: Record<string, unknown>) =>
        Object.assign(new Error(String(input.message)), input),
    );
    vi.stubGlobal(
        "getHeader",
        vi.fn(() => undefined),
    );
    mocks.verify.mockResolvedValue({ ...payload });
    mocks.resolve.mockResolvedValue(user);
    mocks.readSession.mockReturnValue(undefined);
});

describe("authenticated user resolution", () => {
    it("verifies a token, resolves its linked user, and caches the permission context", async () => {
        const request = event();

        await expect(requireUser(request)).resolves.toBe(user);

        expect(mocks.verify).toHaveBeenCalledWith(request);
        expect(mocks.resolve).toHaveBeenCalledWith(request, payload);
        expect(request.context.oauth2).toMatchObject({
            payload,
            permissions: payload.permissions,
            user,
        });
    });

    it("rejects a missing permission before resolving the local user", async () => {
        await expect(
            requireUser(event(), NethackPermissions.Projects.submitOwn),
        ).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: "insufficient_permission",
        });

        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("resolves a missing user in a previously verified token context", async () => {
        const request = event();
        request.context.oauth2 = { payload: { ...payload }, permissions: [], user: undefined };

        await expect(requireUser(request)).resolves.toBe(user);

        expect(mocks.verify).not.toHaveBeenCalled();
        expect(mocks.resolve).toHaveBeenCalledWith(request, payload);
    });

    it("reuses an already resolved authenticated user", async () => {
        const request = event();
        request.context.oauth2 = { payload: { ...payload }, permissions: [], user };

        await expect(requireUser(request)).resolves.toBe(user);

        expect(mocks.verify).not.toHaveBeenCalled();
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("propagates invalid bearer verification failures", async () => {
        const failure = Object.assign(new Error("invalid token"), { statusCode: 401 });
        mocks.verify.mockRejectedValueOnce(failure);

        await expect(requireUser(event())).rejects.toBe(failure);
    });
});

describe("optional user resolution", () => {
    it("returns anonymous when neither a bearer header nor a session exists", async () => {
        await expect(optionalUser(event())).resolves.toBeUndefined();
        expect(mocks.verify).not.toHaveBeenCalled();
    });

    it("authenticates requests with a bearer header", async () => {
        vi.mocked(getHeader).mockReturnValue("Bearer access-token");

        await expect(optionalUser(event())).resolves.toBe(user);
        expect(mocks.verify).toHaveBeenCalledTimes(1);
    });

    it("authenticates requests with a basis-auth session cookie", async () => {
        mocks.readSession.mockReturnValue({
            userId: user.id,
            tokens: { accessToken: "access-token" },
        });

        await expect(optionalUser(event())).resolves.toBe(user);
        expect(mocks.verify).toHaveBeenCalledTimes(1);
    });
});
