import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { mockBody, mockParams, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    firstRow: vi.fn(),
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    updateReturning: vi.fn(),
}));

vi.mock("~~/server/utils/database/query", () => ({ firstRow: mocks.firstRow }));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));

const event = {
    context: {
        drizzle: {
            select: () => ({ from: () => ({ where: () => ({ limit: () => ({}) }) }) }),
            update: () => ({
                set: mocks.updateSet,
            }),
        },
    },
};

let approvalHandler: (event: unknown) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal(
        "getValidatedRouterParams",
        async (_event: unknown, parse: (value: unknown) => unknown) => parse(mockParams.values),
    );
    vi.stubGlobal(
        "readValidatedBody",
        async (_event: unknown, parse: (value: unknown) => unknown) => parse(mockBody.value),
    );
    approvalHandler = (await import("~~/server/api/admin/seasons/[id]/approval.patch")).default;
});

beforeEach(() => {
    resetMockState();
    vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 12 } as never);
    mocks.firstRow.mockResolvedValue({ id: 5, is_blank_start: 1, is_active: 0 });
    mocks.updateReturning.mockResolvedValue([
        { id: 5, board_approved_at: new Date(), board_approved_by: 12 },
    ]);
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mockParams.values = { id: "5" };
    mockBody.value = { approved: true };
});

describe("PATCH /api/admin/seasons/:id/approval", () => {
    it("records board approval with the authenticated administrator and timestamp", async () => {
        await approvalHandler(event);

        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Seasons.update,
        );
        expect(mocks.updateSet).toHaveBeenCalledWith({
            board_approved_at: expect.any(Date),
            board_approved_by: 12,
        });
    });

    it("rejects board approval updates for copied seasons", async () => {
        mocks.firstRow.mockResolvedValueOnce({ id: 5, is_blank_start: 0, is_active: 0 });

        await expect(approvalHandler(event)).rejects.toMatchObject({ statusCode: 409 });
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it("does not allow approval to be revoked while a season is active", async () => {
        mocks.firstRow.mockResolvedValueOnce({ id: 5, is_blank_start: 1, is_active: 1 });
        mockBody.value = { approved: false };

        await expect(approvalHandler(event)).rejects.toMatchObject({ statusCode: 409 });
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it("returns 404 when the season does not exist", async () => {
        mocks.firstRow.mockResolvedValueOnce(undefined);

        await expect(approvalHandler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.updateSet).not.toHaveBeenCalled();
    });

    it("revokes board approval on a blank season that is not active", async () => {
        mocks.updateReturning.mockResolvedValueOnce([
            { id: 5, board_approved_at: null, board_approved_by: null },
        ]);
        mockBody.value = { approved: false };

        await expect(approvalHandler(event)).resolves.toMatchObject({
            board_approved_at: null,
            board_approved_by: null,
        });
        expect(mocks.updateSet).toHaveBeenCalledWith({
            board_approved_at: null,
            board_approved_by: null,
        });
    });

    it("returns 404 when the update matches no row", async () => {
        mocks.updateReturning.mockResolvedValueOnce([]);

        await expect(approvalHandler(event)).rejects.toMatchObject({ statusCode: 404 });
    });
});
