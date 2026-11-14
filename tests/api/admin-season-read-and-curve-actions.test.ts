import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { mockBody, mockParams, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    firstRow: vi.fn(),
    listRubricTemplates: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
}));

vi.mock("~~/server/utils/database/query", () => ({ firstRow: mocks.firstRow }));
vi.mock("~~/server/utils/database/rubrics", () => ({
    resolveLiveRubricVersionId: async (
        _event: unknown,
        season: { rubric_version_id: number | null },
    ) => season.rubric_version_id,
    listRubricTemplates: mocks.listRubricTemplates,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));

const curveQuery = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
};
curveQuery.set.mockReturnValue(curveQuery);
curveQuery.where.mockReturnValue(curveQuery);
curveQuery.returning.mockReturnValue(curveQuery);

const selectQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
};
selectQuery.from.mockReturnValue(selectQuery);
selectQuery.where.mockReturnValue(selectQuery);
selectQuery.limit.mockReturnValue(selectQuery);

const event = { context: { drizzle: { update: mocks.update, select: mocks.select } } };
let patchCurve: (event: any) => Promise<unknown>;
let getSeasonRubric: (event: any) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("readValidatedBody", async (_event: unknown, parse: (body: unknown) => unknown) =>
        parse(mockBody.value),
    );
    patchCurve = (await import("~~/server/api/admin/seasons/[id]/score-curve.patch")).default;
    getSeasonRubric = (await import("~~/server/api/admin/seasons/[id]/rubric.get")).default;
});

beforeEach(() => {
    resetMockState();
    vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 21 } as never);
    mocks.firstRow.mockReset();
    mocks.listRubricTemplates.mockReset();
    mocks.update.mockReset().mockReturnValue(curveQuery);
    mocks.select.mockReset().mockReturnValue(selectQuery);
    curveQuery.set.mockReset().mockReturnValue(curveQuery);
    curveQuery.where.mockReset().mockReturnValue(curveQuery);
    curveQuery.returning.mockReset().mockReturnValue(curveQuery);
    selectQuery.from.mockReset().mockReturnValue(selectQuery);
    selectQuery.where.mockReset().mockReturnValue(selectQuery);
    selectQuery.limit.mockReset().mockReturnValue(selectQuery);
    selectQuery.orderBy.mockReset();
    mockParams.values = {};
});

afterEach(() => vi.restoreAllMocks());

describe("admin score curve update actions", () => {
    it("updates a season to a supported presentation curve", async () => {
        const season = { id: 5, score_curve_preset: "moderate" };
        mockParams.values.id = "5";
        mockBody.value = { preset: "moderate" };
        mocks.firstRow.mockResolvedValue(season);

        await expect(patchCurve(event)).resolves.toEqual({ season_id: 5, preset: "moderate" });
        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Seasons.update,
        );
        expect(mocks.update).toHaveBeenCalledOnce();
        expect(curveQuery.set).toHaveBeenCalledWith({ score_curve_preset: "moderate" });
        expect(mocks.firstRow).toHaveBeenCalledWith(curveQuery);
    });

    it.each([undefined, "0", "-1", "nope"])("rejects invalid season ID %s", async (id) => {
        mockParams.values.id = id;
        mockBody.value = { preset: "original" };

        await expect(patchCurve(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it.each([undefined, "custom", 1, null])(
        "rejects unsupported curve preset %j",
        async (preset) => {
            mockParams.values.id = "5";
            mockBody.value = { preset };

            await expect(patchCurve(event)).rejects.toMatchObject({ name: "ZodError" });
            expect(mocks.update).not.toHaveBeenCalled();
        },
    );

    it("returns not found if the season update matched no row", async () => {
        mockParams.values.id = "5";
        mockBody.value = { preset: "original" };
        mocks.firstRow.mockResolvedValue(undefined);

        await expect(patchCurve(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("does not update a curve when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockParams.values.id = "5";
        mockBody.value = { preset: "original" };

        await expect(patchCurve(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.update).not.toHaveBeenCalled();
    });
});

describe("season rubric history read actions", () => {
    const season = { id: 8, rubric_version_id: 3 };
    const active = { id: 3, season_id: 8, version: 2, name: "Current" };
    const previous = { id: 2, season_id: 8, version: 1, name: "Previous" };
    const template = { id: 4, name: "Template" };

    it("returns ordered rubric versions, the active version, and reusable templates", async () => {
        mockParams.values.id = "8";
        mocks.firstRow.mockResolvedValue(season);
        selectQuery.orderBy.mockResolvedValue([active, previous]);
        mocks.listRubricTemplates.mockResolvedValue([template]);

        await expect(getSeasonRubric(event)).resolves.toEqual({
            active,
            versions: [active, previous],
            templates: [template],
        });
        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Seasons.update,
        );
        expect(mocks.listRubricTemplates).toHaveBeenCalledWith(event);
    });

    it("returns a null active rubric if the version is absent from the history", async () => {
        mockParams.values.id = "8";
        mocks.firstRow.mockResolvedValue({ ...season, rubric_version_id: 77 });
        selectQuery.orderBy.mockResolvedValue([active]);
        mocks.listRubricTemplates.mockResolvedValue([]);

        await expect(getSeasonRubric(event)).resolves.toMatchObject({ active: null });
    });

    it("returns a null active rubric for an empty history", async () => {
        mockParams.values.id = "8";
        mocks.firstRow.mockResolvedValue({ ...season, rubric_version_id: null });
        selectQuery.orderBy.mockResolvedValue([]);
        mocks.listRubricTemplates.mockResolvedValue([]);

        await expect(getSeasonRubric(event)).resolves.toEqual({
            active: null,
            versions: [],
            templates: [],
        });
    });

    it.each([undefined, "0", "not-an-id"])("rejects invalid season ID %s", async (id) => {
        mockParams.values.id = id;

        await expect(getSeasonRubric(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.firstRow).not.toHaveBeenCalled();
    });

    it("returns not found for a season that does not exist", async () => {
        mockParams.values.id = "404";
        mocks.firstRow.mockResolvedValue(null);

        await expect(getSeasonRubric(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.listRubricTemplates).not.toHaveBeenCalled();
    });

    it("does not read rubric history when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockParams.values.id = "8";

        await expect(getSeasonRubric(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.firstRow).not.toHaveBeenCalled();
    });
});
