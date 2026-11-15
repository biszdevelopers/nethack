import { beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    getUser: vi.fn(),
    body: { is_admin: false },
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    updateReturning: vi.fn(),
}));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));

let handler: any;

beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("defineEventHandler", (value: unknown) => value);
    vi.stubGlobal("getValidatedRouterParams", async () => ({ id: 7 }));
    vi.stubGlobal("readValidatedBody", async () => mocks.body);
    vi.stubGlobal("getUser", mocks.getUser);
    vi.stubGlobal("createError", (input: any) =>
        Object.assign(new Error(input.message), { statusCode: input.statusCode }),
    );
    mocks.requireUser.mockResolvedValue({ id: 1, email: "admin@example.test", is_admin: 1 });
    mocks.updateReturning.mockImplementation(async () => [
        { id: 7, is_admin: mocks.body.is_admin ? 1 : 0 },
    ]);
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    const event = {
        context: {
            drizzle: {
                update: () => ({ set: mocks.updateSet }),
            },
        },
    };
    globalThis.__adminEvent = event;
    handler = (await import("~~/server/api/users/[id]/admin.patch")).default;
});

declare global {
    // eslint-disable-next-line no-var
    var __adminEvent: any;
}

describe("PATCH /api/users/:id/admin", () => {
    it("promotes and demotes regular users", async () => {
        mocks.getUser.mockResolvedValue({ id: 7, email: "user@example.test", is_admin: 0 });

        mocks.body = { is_admin: true };
        await expect(handler(globalThis.__adminEvent)).resolves.toEqual({
            id: 7,
            is_admin: true,
        });
        expect(mocks.updateSet).toHaveBeenCalledWith({ is_admin: 1 });
        expect(mocks.requireUser).toHaveBeenCalledWith(
            globalThis.__adminEvent,
            NethackPermissions.all,
        );

        mocks.body = { is_admin: false };
        await expect(handler(globalThis.__adminEvent)).resolves.toEqual({
            id: 7,
            is_admin: false,
        });
    });

    it("rejects demoting a designated initial administrator", async () => {
        mocks.getUser.mockResolvedValue({
            id: 7,
            email: "Cindy.Cheng-Bisz@basischina.com",
            is_admin: 1,
        });

        await expect(handler(globalThis.__adminEvent)).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it("rejects self-demotion and missing users", async () => {
        mocks.getUser.mockResolvedValue({ id: 1, email: "admin@example.test", is_admin: 1 });
        await expect(handler(globalThis.__adminEvent)).rejects.toMatchObject({
            statusCode: 403,
        });

        mocks.getUser.mockResolvedValue(undefined);
        await expect(handler(globalThis.__adminEvent)).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("returns 404 when the database update finds no row", async () => {
        mocks.getUser.mockResolvedValue({ id: 7, email: "user@example.test", is_admin: 0 });
        mocks.body = { is_admin: true };
        mocks.updateReturning.mockResolvedValueOnce([]);

        await expect(handler(globalThis.__adminEvent)).rejects.toMatchObject({
            statusCode: 404,
        });
    });
});
