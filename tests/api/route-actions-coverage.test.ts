import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { DEFAULT_JUDGE_COMMENT_GUIDANCE } from "~~/shared/judge-comments";
import {
    mockBody,
    mockParams,
    mockQueryState,
    resetMockState,
    setupNitroGlobals,
} from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    revokeBasisAuthToken: vi.fn(),
    readBasisAuthUserSession: vi.fn(),
    clearBasisAuthUserSession: vi.fn(),
    setResponseHeader: vi.fn(),
    deleteTeams: vi.fn(),
    getActiveSeason: vi.fn(),
    getSeasonById: vi.fn(),
    computeScores: vi.fn(),
    firstRow: vi.fn(),
    listRubricTemplates: vi.fn(),
    getRubricVersionForSeason: vi.fn(),
}));

const rubricQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
};
rubricQuery.from.mockReturnValue(rubricQuery);
rubricQuery.where.mockReturnValue(rubricQuery);
rubricQuery.limit.mockReturnValue(rubricQuery);

vi.mock("h3", () => ({ setResponseHeader: mocks.setResponseHeader }));
vi.mock("~~/server/utils/basis-auth", () => ({ revokeBasisAuthToken: mocks.revokeBasisAuthToken }));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    clearBasisAuthUserSession: mocks.clearBasisAuthUserSession,
    readBasisAuthUserSession: mocks.readBasisAuthUserSession,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    AUTH_RATE_LIMIT_CONFIG: {},
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/database/teams", () => ({ deleteTeams: mocks.deleteTeams }));
vi.mock("~~/server/utils/database/seasons", () => ({
    getActiveSeason: mocks.getActiveSeason,
    getSeasonById: mocks.getSeasonById,
}));
vi.mock("~~/server/utils/scoring", () => ({ computeScores: mocks.computeScores }));
vi.mock("~~/server/utils/database/query", () => ({ firstRow: mocks.firstRow }));
vi.mock("~~/server/utils/database/rubrics", () => ({
    listRubricTemplates: mocks.listRubricTemplates,
    getRubricVersionForSeason: mocks.getRubricVersionForSeason,
}));

const event = { context: { drizzle: { select: vi.fn() } } };
let logout: (event: any) => Promise<unknown>;
let deleteTeams: (event: any) => Promise<unknown>;
let judgingRubric: (event: any) => Promise<unknown>;
let compute: (event: any) => Promise<unknown>;
let activeRubric: (event: any) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("deleteTeams", mocks.deleteTeams);
    vi.stubGlobal("readValidatedBody", async (_event: unknown, parse: (body: unknown) => unknown) =>
        parse(mockBody.value),
    );
    vi.stubGlobal(
        "getValidatedQuery",
        async (_event: unknown, parse: (query: unknown) => unknown) => parse(mockQueryState.value),
    );
    logout = (await import("~~/server/api/auth/logout.post")).default;
    deleteTeams = (await import("~~/server/api/admin/teams.delete")).default;
    judgingRubric = (await import("~~/server/api/judging/rubric.get")).default;
    compute = (await import("~~/server/api/admin/scores/compute.post")).default;
    activeRubric = (await import("~~/server/api/seasons/active/rubric.get")).default;
});

beforeEach(() => {
    resetMockState();
    vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 12 } as never);
    for (const mock of Object.values(mocks)) mock.mockReset();
    event.context.drizzle.select.mockReset();
    event.context.drizzle.select.mockReturnValue(rubricQuery);
    rubricQuery.from.mockReset().mockReturnValue(rubricQuery);
    rubricQuery.where.mockReset().mockReturnValue(rubricQuery);
    rubricQuery.limit.mockReset().mockReturnValue(rubricQuery);
    vi.stubGlobal("deleteTeams", mocks.deleteTeams);
    mockQueryState.value = {};
});

afterEach(() => vi.restoreAllMocks());

describe("logout route actions", () => {
    it("revokes a refresh token, prevents caching, and clears the session", async () => {
        mocks.readBasisAuthUserSession.mockReturnValue({ tokens: { refreshToken: "refresh" } });
        mocks.revokeBasisAuthToken.mockResolvedValue(undefined);
        const response = {};

        await expect(logout({ node: { res: response } } as any)).resolves.toEqual({
            loggedOut: true,
        });
        expect(mocks.setResponseHeader).toHaveBeenCalledWith(
            { node: { res: response } },
            "cache-control",
            "no-store",
        );
        expect(mocks.revokeBasisAuthToken).toHaveBeenCalledWith("refresh");
        expect(mocks.clearBasisAuthUserSession).toHaveBeenCalledOnce();
    });

    it.each([
        ["no request node", {}],
        ["no response object", { node: {} }],
    ])("handles %s without attempting response headers", async (_label, request) => {
        mocks.readBasisAuthUserSession.mockReturnValue(undefined);

        await expect(logout(request as any)).resolves.toEqual({ loggedOut: true });
        expect(mocks.setResponseHeader).not.toHaveBeenCalled();
        expect(mocks.revokeBasisAuthToken).not.toHaveBeenCalled();
        expect(mocks.clearBasisAuthUserSession).toHaveBeenCalledOnce();
    });

    it("clears the session when token reading fails", async () => {
        const failure = new Error("session read failed");
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        mocks.readBasisAuthUserSession.mockImplementation(() => {
            throw failure;
        });

        await expect(logout({} as any)).resolves.toEqual({ loggedOut: true });
        expect(warning).toHaveBeenCalledWith("basis-auth token revocation failed", failure);
        expect(mocks.clearBasisAuthUserSession).toHaveBeenCalledOnce();
    });

    it("clears the session when revocation fails", async () => {
        const failure = new Error("revocation failed");
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        mocks.readBasisAuthUserSession.mockReturnValue({ tokens: { refreshToken: "refresh" } });
        mocks.revokeBasisAuthToken.mockRejectedValue(failure);

        await expect(logout({} as any)).resolves.toEqual({ loggedOut: true });
        expect(warning).toHaveBeenCalledWith("basis-auth token revocation failed", failure);
        expect(mocks.clearBasisAuthUserSession).toHaveBeenCalledOnce();
    });
});

describe("admin team deletion actions", () => {
    it("authorizes the deletion and reports the number of removed teams", async () => {
        mockBody.value = { ids: [3, 8] };
        mocks.deleteTeams.mockResolvedValue(undefined);

        await expect(deleteTeams(event)).resolves.toEqual({ message: "Deleted 2 team(s)" });
        expect(globalThis.requireUser).toHaveBeenCalledWith(event, NethackPermissions.Teams.delete);
        expect(mocks.deleteTeams).toHaveBeenCalledWith(event, [3, 8]);
    });

    it.each([undefined, { ids: [0] }, { ids: [1.5] }, { ids: "2" }])(
        "rejects invalid deletion input %j before writing",
        async (body) => {
            mockBody.value = body;
            await expect(deleteTeams(event)).rejects.toMatchObject({ name: "ZodError" });
            expect(mocks.deleteTeams).not.toHaveBeenCalled();
        },
    );

    it("stops when the user lacks permission", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockBody.value = { ids: [3] };

        await expect(deleteTeams(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.deleteTeams).not.toHaveBeenCalled();
    });

    it("propagates database deletion failures", async () => {
        const failure = new Error("database unavailable");
        mockBody.value = { ids: [3] };
        mocks.deleteTeams.mockRejectedValue(failure);

        await expect(deleteTeams(event)).rejects.toBe(failure);
    });
});

describe("judge rubric read actions", () => {
    const season = { id: 4, rubric_version_id: 7 };
    const version = { id: 7, season_id: 4, name: "Active rubric", definition: { tracks: [] } };

    it("returns the active season rubric to authorized judges", async () => {
        mocks.getActiveSeason.mockResolvedValue(season);
        mocks.firstRow.mockResolvedValue(version);

        await expect(judgingRubric(event)).resolves.toEqual({
            version_id: 7,
            name: "Active rubric",
            tracks: [],
            commentGuidance: DEFAULT_JUDGE_COMMENT_GUIDANCE,
        });
        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Judging.assignmentsRead,
        );
    });

    it.each([null, { id: 4, rubric_version_id: null }])(
        "reports conflict when active season has no rubric (%j)",
        async (active) => {
            mocks.getActiveSeason.mockResolvedValue(active);
            await expect(judgingRubric(event)).rejects.toMatchObject({ statusCode: 409 });
            expect(mocks.firstRow).not.toHaveBeenCalled();
        },
    );

    it("reports conflict when the active version is unavailable", async () => {
        mocks.getActiveSeason.mockResolvedValue(season);
        mocks.firstRow.mockResolvedValue(undefined);

        await expect(judgingRubric(event)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects a version belonging to a different season", async () => {
        mocks.getActiveSeason.mockResolvedValue(season);
        mocks.firstRow.mockResolvedValue({ ...version, season_id: 99 });

        await expect(judgingRubric(event)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("does not query the rubric when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        await expect(judgingRubric(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.getActiveSeason).not.toHaveBeenCalled();
    });
});

describe("admin score computation actions", () => {
    it("computes scores for an explicit validated season", async () => {
        mockQueryState.value = { season_id: "6" };
        mocks.getSeasonById.mockResolvedValue({ id: 6 });

        await expect(compute(event)).resolves.toEqual({
            message: "Scores and ranks were recomputed.",
            season_id: 6,
        });
        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Judging.resultsCompute,
        );
        expect(mocks.getSeasonById).toHaveBeenCalledWith(event, 6);
        expect(mocks.getActiveSeason).not.toHaveBeenCalled();
        expect(mocks.computeScores).toHaveBeenCalledWith(event, 6);
    });

    it("uses the active season when no ID is supplied", async () => {
        mocks.getActiveSeason.mockResolvedValue({ id: 9 });

        await expect(compute(event)).resolves.toMatchObject({ season_id: 9 });
        expect(mocks.getActiveSeason).toHaveBeenCalledWith(event);
        expect(mocks.computeScores).toHaveBeenCalledWith(event, 9);
    });

    it("rejects malformed season IDs before looking up a season", async () => {
        mockQueryState.value = { season_id: "invalid" };

        await expect(compute(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.getSeasonById).not.toHaveBeenCalled();
        expect(mocks.computeScores).not.toHaveBeenCalled();
    });

    it("returns not found when the requested season does not exist", async () => {
        mockQueryState.value = { season_id: "17" };
        mocks.getSeasonById.mockResolvedValue(null);

        await expect(compute(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.computeScores).not.toHaveBeenCalled();
    });

    it("returns not found when there is no active season", async () => {
        mocks.getActiveSeason.mockResolvedValue(undefined);

        await expect(compute(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.computeScores).not.toHaveBeenCalled();
    });

    it("does not compute scores when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        await expect(compute(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.getActiveSeason).not.toHaveBeenCalled();
    });

    it("propagates computation failures", async () => {
        const failure = new Error("scoring failed");
        mocks.getActiveSeason.mockResolvedValue({ id: 11 });
        mocks.computeScores.mockRejectedValue(failure);

        await expect(compute(event)).rejects.toBe(failure);
    });
});

describe("public active rubric actions", () => {
    it("returns the active season criteria without requiring login", async () => {
        const tracks = [{ id: "open", criteria: [] }];
        mocks.getActiveSeason.mockResolvedValue({ id: 12 });
        mocks.getRubricVersionForSeason.mockResolvedValue({ id: 18, definition: { tracks } });

        await expect(activeRubric(event)).resolves.toEqual({ version_id: 18, tracks });
        expect(mocks.getRubricVersionForSeason).toHaveBeenCalledWith(event, 12);
        expect(globalThis.requireUser).not.toHaveBeenCalled();
    });

    it("returns not found when no season is active", async () => {
        mocks.getActiveSeason.mockResolvedValue(null);

        await expect(activeRubric(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.getRubricVersionForSeason).not.toHaveBeenCalled();
    });

    it("returns conflict when the active season has no rubric", async () => {
        mocks.getActiveSeason.mockResolvedValue({ id: 13 });
        mocks.getRubricVersionForSeason.mockResolvedValue(null);

        await expect(activeRubric(event)).rejects.toMatchObject({ statusCode: 409 });
    });
});
