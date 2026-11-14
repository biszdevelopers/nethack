import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
    createTestContext,
    resetMockState,
    resetTestContext,
    setupNitroGlobals,
    mockBody,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    type TestContext,
} from "../../helpers";

const assetMocks = vi.hoisted(() => ({
    createUserAssetContentAddressed: vi.fn(),
    getUserAssetContentAddress: vi.fn(),
    withAssetLifecycleLocks: vi.fn(),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
}));
vi.mock("~~/server/utils/assets", () => assetMocks);

let ctx: TestContext;
let handler: (event: unknown) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    handler = (await import("~~/server/api/users/[id]/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    assetMocks.createUserAssetContentAddressed.mockReset();
    assetMocks.getUserAssetContentAddress.mockReset();
    assetMocks.withAssetLifecycleLocks.mockReset();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

describe("PATCH /api/users/:id empty update", () => {
    it("returns success without opening an asset lock or writing an unchanged profile", async () => {
        const user = seedUser(ctx, { email: "empty-profile@basischina.com", name: "Unchanged" });
        mockParams.values["id"] = String(user.id);
        mockSession.value = { user: { id: user.id } };
        mockBody.value = {};

        const body = Buffer.from("{}");
        const event = {
            context: { drizzle: ctx.drizzle },
            path: `/api/users/${user.id}`,
            method: "PATCH",
            node: {
                req: Object.assign(Readable.from([body]), {
                    headers: {
                        "content-length": String(body.byteLength),
                        "content-type": "application/json",
                    },
                }),
            },
        };

        await expect(handler(event)).resolves.toEqual({ message: "Your profile is updated" });
        expect(assetMocks.withAssetLifecycleLocks).not.toHaveBeenCalled();
        expect(assetMocks.createUserAssetContentAddressed).not.toHaveBeenCalled();
    });
});
