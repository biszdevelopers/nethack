import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockBody, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    firstRow: vi.fn(),
    setActiveSeason: vi.fn(),
    getSeasons: vi.fn(),
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    insertValues: vi.fn(),
    insertReturning: vi.fn(),
}));

vi.mock("~~/server/utils/database/query", () => ({ firstRow: mocks.firstRow }));
vi.mock("~~/server/utils/database/seasons", () => ({
    setActiveSeason: mocks.setActiveSeason,
}));

let patchHandler: any;
let postHandler: any;
let event: any;

beforeEach(async () => {
    resetMockState();
    setupNitroGlobals();
    vi.clearAllMocks();
    mockBody.value = { id: 1, name: "Renamed" };

    mocks.requireUser.mockResolvedValue({ id: 7 });
    mocks.firstRow.mockResolvedValue({ id: 1, name: "Season 1", is_active: 1 });
    mocks.setActiveSeason.mockResolvedValue(undefined);
    mocks.getSeasons.mockResolvedValue([{ id: 1, name: "Renamed", is_active: 1 }]);
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.insertReturning.mockResolvedValue([{ id: 5 }]);
    mocks.insertValues.mockReturnValue({ returning: mocks.insertReturning });

    vi.stubGlobal("requireUser", mocks.requireUser);
    vi.stubGlobal("getSeasons", mocks.getSeasons);

    const selectChain: any = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => selectChain,
    };
    event = {
        context: {
            drizzle: {
                select: () => selectChain,
                update: () => ({ set: mocks.updateSet }),
                insert: () => ({ values: mocks.insertValues }),
            },
        },
    };

    patchHandler = (await import("~~/server/api/admin/seasons/index.patch")).default;
    postHandler = (await import("~~/server/api/admin/seasons/index.post")).default;
});

describe("PATCH /api/admin/seasons action edges", () => {
    it("renames a season without touching activation", async () => {
        await expect(patchHandler(event)).resolves.toHaveProperty("seasons");
        expect(mocks.updateSet).toHaveBeenCalledWith({ name: "Renamed" });
        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
    });

    it("activates a season through the activation flow", async () => {
        mockBody.value = { id: 1, is_active: 1 };

        await patchHandler(event);

        expect(mocks.setActiveSeason).toHaveBeenCalledWith(event, 1);
    });

    it("deactivates the currently active season", async () => {
        mockBody.value = { id: 1, is_active: 0 };

        await patchHandler(event);

        expect(mocks.setActiveSeason).toHaveBeenCalledWith(event, null);
    });

    it("ignores deactivation for a season that is already inactive", async () => {
        mocks.firstRow.mockResolvedValue({ id: 1, name: "Old", is_active: 0 });
        mockBody.value = { id: 1, is_active: 0 };

        await patchHandler(event);

        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
    });

    it("rejects an empty update and an unknown season", async () => {
        mockBody.value = { id: 1 };
        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 400 });

        mockBody.value = { id: 9, name: "Ghost" };
        mocks.firstRow.mockResolvedValue(undefined);
        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("maps unique violations to 409 and rethrows other failures", async () => {
        mocks.updateWhere.mockRejectedValueOnce(
            Object.assign(new Error("duplicate"), { code: "23505" }),
        );
        await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 409 });

        mocks.updateWhere.mockRejectedValueOnce(new Error("connection lost"));
        await expect(patchHandler(event)).rejects.toThrow("connection lost");
    });
});

describe("POST /api/admin/seasons action edges", () => {
    it("creates an inactive season", async () => {
        mockBody.value = { name: "New season" };

        await expect(postHandler(event)).resolves.toHaveProperty("seasons");
        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
    });

    it("creates and activates a season", async () => {
        mockBody.value = { name: "New season", is_active: 1 };

        await postHandler(event);

        expect(mocks.setActiveSeason).toHaveBeenCalledWith(event, 5);
    });

    it("does not activate when the insert returns no row", async () => {
        mocks.insertReturning.mockResolvedValueOnce([]);
        mockBody.value = { name: "New season", is_active: 1 };

        await postHandler(event);

        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
    });

    it("maps unique violations to 409 and rethrows other failures", async () => {
        mocks.insertReturning.mockRejectedValueOnce(
            Object.assign(new Error("duplicate"), { code: "23505" }),
        );
        await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 409 });

        mocks.insertReturning.mockRejectedValueOnce(new Error("disk offline"));
        await expect(postHandler(event)).rejects.toThrow("disk offline");
    });
});
