import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    user: { id: 9 },
    admin: false,
    query: {} as Record<string, string>,
    requireUser: vi.fn(async () => mocks.user),
    listAssetReferences: vi.fn(async () => ({
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        total_pages: 0,
    })),
    hasNethackPermission: vi.fn(() => mocks.admin),
}));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/assets", () => ({ listAssetReferences: mocks.listAssetReferences }));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/shared/permissions", () => ({
    hasNethackPermission: mocks.hasNethackPermission,
    NethackPermissions: { all: "nethack.all" },
}));

describe("asset permalink reference listing route", () => {
    let list: (event: any) => Promise<unknown>;
    let event: any;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal(
            "getValidatedQuery",
            async (_event: unknown, parse: (value: unknown) => unknown) => parse(mocks.query),
        );
        mocks.user = { id: 9 };
        mocks.admin = false;
        mocks.query = {};
        mocks.requireUser.mockReset().mockImplementation(async () => mocks.user);
        mocks.listAssetReferences.mockReset().mockResolvedValue({
            items: [],
            page: 1,
            page_size: 20,
            total: 0,
            total_pages: 0,
        });
        mocks.hasNethackPermission.mockReset().mockImplementation(() => mocks.admin);
        event = { context: { drizzle: {}, oauth2: { permissions: [] } } };
        list = (await import("~~/server/api/assets/references/index.get")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it("lists only the authenticated owner's references with bounded pagination", async () => {
        mocks.query = { page: "2", page_size: "10" };
        const result = {
            items: [
                {
                    id: "3e45b75f-8a46-4b98-b3dc-a6ad84955e45",
                    collection: "assets",
                    asset_path: "uploads/example.png",
                    permalink: "/assets/uploads/example.png",
                    created_at: "2026-11-14T00:00:00.000Z",
                },
            ],
            page: 2,
            page_size: 10,
            total: 11,
            total_pages: 2,
        };
        mocks.listAssetReferences.mockResolvedValue(result);

        await expect(list(event)).resolves.toEqual(result);
        expect(mocks.requireUser).toHaveBeenCalledWith(event);
        expect(mocks.listAssetReferences).toHaveBeenCalledWith(event.context.drizzle, 9, false, {
            page: 2,
            pageSize: 10,
        });
    });

    it("allows admins to list references across owners", async () => {
        mocks.admin = true;

        await expect(list(event)).resolves.toMatchObject({ page: 1, page_size: 20 });
        expect(mocks.listAssetReferences).toHaveBeenCalledWith(event.context.drizzle, 9, true, {
            page: 1,
            pageSize: 20,
        });
    });

    it("rejects out-of-range pagination before querying references", async () => {
        mocks.query = { page: "0", page_size: "1000" };

        await expect(list(event)).rejects.toBeDefined();
        expect(mocks.requireUser).not.toHaveBeenCalled();
        expect(mocks.listAssetReferences).not.toHaveBeenCalled();
    });
});
