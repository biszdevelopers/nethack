import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockBody, mockParams, resetMockState, setupNitroGlobals } from "./helpers";
import { UpdateSeasonTweaksRequest } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

let patchTweaksHandler: (event: unknown) => Promise<unknown>;
let getTweaksHandler: (event: unknown) => Promise<unknown>;
const updateSeasonTweaks = vi.fn();
const getSeasonById = vi.fn();
const readValidatedBody = vi.fn(async (_event: unknown, parse: (body: unknown) => unknown) =>
    parse(mockBody.value),
);

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("readValidatedBody", readValidatedBody);
    vi.stubGlobal("updateSeasonTweaks", updateSeasonTweaks);
    vi.stubGlobal("getSeasonById", getSeasonById);
    patchTweaksHandler = (await import("~~/server/api/seasons/[id]/tweaks.patch")).default;
    getTweaksHandler = (await import("~~/server/api/seasons/[id]/tweaks.get")).default;
});

beforeEach(() => {
    resetMockState();
    mockParams.values.id = "12";
    updateSeasonTweaks.mockReset().mockResolvedValue({ id: 12 });
    getSeasonById.mockReset();
    readValidatedBody.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PATCH /api/seasons/:id/tweaks action edges", () => {
    it("checks the season update permission before reading a request body", async () => {
        await expect(patchTweaksHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 401,
        });

        expect(globalThis.requireUser).toHaveBeenCalledWith(
            { context: {} },
            NethackPermissions.Seasons.update,
        );
        expect(readValidatedBody).not.toHaveBeenCalled();
        expect(updateSeasonTweaks).not.toHaveBeenCalled();
    });

    it.each([
        ["a missing value", undefined],
        ["an empty value", ""],
        ["text", "season-one"],
        ["a numeric prefix followed by text", "12extra"],
        ["a fractional value", "12.5"],
        ["a negative value", "-12"],
        ["zero", "0"],
        ["a signed value", "+12"],
        ["an unsafe integer", "9007199254740992"],
    ])("rejects %s before reading or updating", async (_label, id) => {
        vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 7, role: "admin" } as never);
        mockParams.values.id = id;

        await expect(patchTweaksHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid season ID",
        });

        expect(readValidatedBody).not.toHaveBeenCalled();
        expect(updateSeasonTweaks).not.toHaveBeenCalled();
    });

    it("skips explicitly undefined optional fields after validating a defined tweak", async () => {
        vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 7, role: "admin" } as never);
        mockBody.value = { status: "voting", show_scores: undefined };

        await expect(patchTweaksHandler({ context: {} })).resolves.toEqual({
            message: "Season tweaks updated",
        });

        expect(updateSeasonTweaks).toHaveBeenCalledWith({ context: {} }, 12, { status: "voting" });
    });

    it("rejects an invalid status before attempting the update", async () => {
        vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 7, role: "admin" } as never);
        mockBody.value = { status: "not-a-season-status" };

        await expect(patchTweaksHandler({ context: {} })).rejects.toMatchObject({
            name: "ZodError",
        });

        expect(updateSeasonTweaks).not.toHaveBeenCalled();
    });
});

describe("GET /api/seasons/:id/tweaks route parameters", () => {
    it("returns the requested season for a valid positive safe integer ID", async () => {
        const season = { id: 12, name: "Season 12" };
        getSeasonById.mockResolvedValue(season);

        await expect(getTweaksHandler({ context: {} })).resolves.toMatchObject({
            id: season.id,
            name: season.name,
        });

        expect(getSeasonById).toHaveBeenCalledWith({ context: {} }, 12);
    });

    it("returns 404 when the valid season ID does not exist", async () => {
        getSeasonById.mockResolvedValue(undefined);

        await expect(getTweaksHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 404,
            statusMessage: "Season not found",
        });

        expect(getSeasonById).toHaveBeenCalledWith({ context: {} }, 12);
    });

    it.each([
        ["a missing value", undefined],
        ["an empty value", ""],
        ["text", "season-one"],
        ["a numeric prefix followed by text", "12extra"],
        ["a fractional value", "12.5"],
        ["a negative value", "-12"],
        ["zero", "0"],
        ["a signed value", "+12"],
        ["an unsafe integer", "9007199254740992"],
    ])("rejects %s before looking up a season", async (_label, id) => {
        mockParams.values.id = id;

        await expect(getTweaksHandler({ context: {} })).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid season ID",
        });

        expect(getSeasonById).not.toHaveBeenCalled();
    });
});
