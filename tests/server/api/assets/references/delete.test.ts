import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    referenceId: "3e45b75f-8a46-4b98-b3dc-a6ad84955e45",
    user: { id: 9 },
    admin: false,
    requireUser: vi.fn(async () => mocks.user),
    releaseAssetReference: vi.fn(async () => true),
    hasNethackPermission: vi.fn(() => mocks.admin),
}));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/assets", () => ({
    releaseAssetReference: mocks.releaseAssetReference,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
}));
vi.mock("~~/shared/permissions", () => ({
    hasNethackPermission: mocks.hasNethackPermission,
    NethackPermissions: { all: "nethack.all" },
}));

describe("asset permalink release route", () => {
    let remove: (event: any) => Promise<unknown>;
    let event: any;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal(
            "getValidatedRouterParams",
            async (_event: unknown, parse: (value: unknown) => unknown) =>
                parse({ referenceId: mocks.referenceId }),
        );
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.statusMessage), error),
        );
        mocks.admin = false;
        mocks.requireUser.mockReset().mockResolvedValue(mocks.user);
        mocks.releaseAssetReference.mockReset().mockResolvedValue(true);
        mocks.hasNethackPermission.mockReset().mockImplementation(() => mocks.admin);
        event = { context: { drizzle: {}, oauth2: { permissions: [] } } };
        remove = (await import("~~/server/api/assets/references/[referenceId].delete")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it("allows an authenticated owner to release their permalink reference", async () => {
        await expect(remove(event)).resolves.toEqual({ message: "Asset permalink released" });
        expect(mocks.requireUser).toHaveBeenCalledWith(event);
        expect(mocks.releaseAssetReference).toHaveBeenCalledWith(
            event.context.drizzle,
            mocks.referenceId,
            9,
            false,
        );
    });

    it("passes admin status to the service for cross-owner release", async () => {
        mocks.admin = true;
        await expect(remove(event)).resolves.toEqual({ message: "Asset permalink released" });
        expect(mocks.releaseAssetReference).toHaveBeenCalledWith(
            event.context.drizzle,
            mocks.referenceId,
            9,
            true,
        );
    });

    it("returns the same not-found response for unknown or unowned references", async () => {
        mocks.releaseAssetReference.mockResolvedValue(false);
        await expect(remove(event)).rejects.toMatchObject({
            statusCode: 404,
            statusMessage: "Asset reference not found",
        });
    });

    it("rejects malformed reference IDs before authorization", async () => {
        vi.stubGlobal(
            "getValidatedRouterParams",
            async (_event: unknown, parse: (value: unknown) => unknown) =>
                parse({ referenceId: "bad-id" }),
        );
        await expect(remove(event)).rejects.toBeDefined();
        expect(mocks.requireUser).not.toHaveBeenCalled();
        expect(mocks.releaseAssetReference).not.toHaveBeenCalled();
    });
});
