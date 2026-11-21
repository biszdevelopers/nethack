import { beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { mockBody, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    firstRow: vi.fn(),
    setActiveSeason: vi.fn(),
    getSeasons: vi.fn(),
    getHackathon: vi.fn(),
    getActiveSeason: vi.fn(),
    pickSeasonConfig: vi.fn(),
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    insertValues: vi.fn(),
    insertReturning: vi.fn(),
}));

vi.mock("~~/server/utils/database/query", () => ({
    firstRow: mocks.firstRow,
    isUniqueViolation: (error: unknown) =>
        (error as { code?: string })?.code === "23505" ||
        (error as { cause?: { code?: string } })?.cause?.code === "23505",
}));
vi.mock("~~/server/utils/database/seasons", () => ({
    setActiveSeason: mocks.setActiveSeason,
    getActiveSeason: mocks.getActiveSeason,
    pickSeasonConfig: mocks.pickSeasonConfig,
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
    mocks.getHackathon.mockResolvedValue({ status: "voting", theme_name: "Live theme" });
    mocks.getActiveSeason.mockResolvedValue({ id: 1, score_curve_preset: "gentle" });
    mocks.pickSeasonConfig.mockReturnValue({ status: "voting", theme_name: "Live theme" });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.insertReturning.mockResolvedValue([{ id: 5 }]);
    mocks.insertValues.mockReturnValue({ returning: mocks.insertReturning });

    vi.stubGlobal("requireUser", mocks.requireUser);
    vi.stubGlobal("getSeasons", mocks.getSeasons);
    vi.stubGlobal("getHackathon", mocks.getHackathon);

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
        expect(mocks.requireUser).toHaveBeenCalledWith(event, NethackPermissions.Seasons.activate);
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
    const forcedFields = {
        status: "not_started",
        voting_enabled: 0,
        results_published: 0,
        results_published_at: null,
        results_snapshot: null,
        show_scores: 0,
        show_ranking: 0,
        judging_open: 0,
        max_votes_per_user: 0,
        announcement: null,
        score_curve_preset: "original",
    };

    it("creates an inactive season as a copy of the live settings", async () => {
        mockBody.value = { name: "New season" };

        await expect(postHandler(event)).resolves.toHaveProperty("seasons");
        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
        expect(mocks.insertValues).toHaveBeenCalledWith({
            ...forcedFields,
            name: "New season",
            is_active: 0,
            is_blank_start: 0,
        });
    });

    it("creates a season when the live configuration is unavailable", async () => {
        mocks.getHackathon.mockRejectedValueOnce(new Error("offline"));
        mocks.getActiveSeason.mockResolvedValueOnce(null);
        mockBody.value = { name: "Offline season" };

        await expect(postHandler(event)).resolves.toHaveProperty("seasons");
        expect(mocks.insertValues).toHaveBeenCalledWith({
            ...forcedFields,
            name: "Offline season",
            is_active: 0,
            is_blank_start: 0,
        });
    });

    it("creates and activates a season", async () => {
        mockBody.value = { name: "New season", is_active: 1 };

        await postHandler(event);

        expect(mocks.insertValues).toHaveBeenCalledWith({
            ...forcedFields,
            name: "New season",
            is_active: 0,
            is_blank_start: 0,
        });
        expect(mocks.setActiveSeason).toHaveBeenCalledWith(event, 5);
        expect(mocks.requireUser).toHaveBeenCalledWith(event, NethackPermissions.Seasons.activate);
    });

    it("removes a newly created season when activation fails", async () => {
        mockBody.value = { name: "Stray season", is_active: 1 };
        mocks.setActiveSeason.mockRejectedValueOnce(new Error("not ready"));
        const deleteWhere = vi.fn().mockResolvedValue(undefined);
        event.context.drizzle.delete = vi.fn(() => ({ where: deleteWhere }));

        await expect(postHandler(event)).rejects.toThrow("not ready");
        expect(deleteWhere).toHaveBeenCalledOnce();
    });

    it("preserves the activation error when cleanup also fails", async () => {
        mockBody.value = { name: "Stray season", is_active: 1 };
        mocks.setActiveSeason.mockRejectedValueOnce(new Error("not ready"));
        const deleteWhere = vi.fn().mockRejectedValue(new Error("cleanup failed"));
        event.context.drizzle.delete = vi.fn(() => ({ where: deleteWhere }));

        await expect(postHandler(event)).rejects.toThrow("not ready");
    });

    it("does not create a blank season as active", async () => {
        mockBody.value = { name: "Blank season", copy_live_settings: false, is_active: 1 };

        await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 409 });
        expect(mocks.insertValues).not.toHaveBeenCalled();
        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
    });

    it("creates an inactive blank season shell without live settings", async () => {
        mockBody.value = { name: "Blank shell", copy_live_settings: false };

        await expect(postHandler(event)).resolves.toHaveProperty("seasons");
        expect(mocks.insertValues).toHaveBeenCalledWith({
            ...forcedFields,
            name: "Blank shell",
            is_active: 0,
            is_blank_start: 1,
        });
        expect(mocks.getActiveSeason).not.toHaveBeenCalled();
        expect(mocks.pickSeasonConfig).not.toHaveBeenCalled();
        expect(mocks.setActiveSeason).not.toHaveBeenCalled();
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
