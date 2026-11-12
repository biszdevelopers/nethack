import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockParams,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "./helpers";
import { eq, and } from "drizzle-orm";
import { hackathon, judgingDrafts, seasons, teamScores } from "~~/server/database/schema";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

const createTeamScoresMock = vi.hoisted(() => vi.fn());
const getTeamMock = vi.hoisted(() => vi.fn());

vi.mock("~~/server/utils/database/teams", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/database/teams")>();
    getTeamMock.mockImplementation(actual.getTeam);
    return { ...actual, getTeam: getTeamMock };
});

vi.mock("~~/server/utils/database/scores", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/database/scores")>();
    createTeamScoresMock.mockImplementation(actual.createTeamScores);
    return { ...actual, createTeamScores: createTeamScoresMock };
});

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    VOTE_RATE_LIMIT_CONFIG: { maxRequests: 600, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let scoresHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    const scoresDb = await import("~~/server/utils/database/scores");
    vi.stubGlobal("createTeamScores", scoresDb.createTeamScores);

    scoresHandler = (await import("~~/server/api/teams/[id]/scores/index.post")).default;
});

beforeEach(async () => {
    resetMockState();
    getTeamMock.mockClear();
    createTeamScoresMock.mockClear();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "voting", judging_open: 1 });
    seedSeason(ctx);
    // Seed a judge user for FK constraints
    seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return {
        context: { drizzle: ctx.drizzle },
        ...overrides,
    };
}

describe("POST /api/teams/:id/scores", () => {
    const validScores = {
        originality: 4,
        presentation: 3,
        technicality: 5,
        theme: 2,
        impact: 4,
    };

    function prepareScoringRequest(teamId: number, overrides: Record<string, unknown> = {}) {
        vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 1, role: "judge" } as any);
        mockParams.values.id = String(teamId);
        mockBody.value = {
            rubric_version_id: 1,
            scores: validScores,
            reasoning: "A thoughtful review with specific evidence for the submitted project.",
            ...overrides,
        };
    }

    it("submits judge scores for a team", async () => {
        vi.mocked(globalThis.requireJudge).mockResolvedValue({ id: 1, role: "judge" });

        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 4,
                presentation: 3,
                technicality: 5,
                theme: 2,
                impact: 4,
            },
            reasoning: "Well-built project with clear presentation.",
        };

        const result = await scoresHandler(createEvent());

        expect(result).toEqual({ message: "Successfully scored project" });

        const score = ctx.drizzle
            .select()
            .from(teamScores)
            .where(and(eq(teamScores.team_id, team.id), eq(teamScores.judge_user_id, 1)))
            .get();
        expect(score).toBeTruthy();
        expect(score!.reasoning).toBe("Well-built project with clear presentation.");
    });

    it("rejects finalizing with a different rubric than the saved draft", async () => {
        vi.mocked(globalThis.requireJudge).mockResolvedValue({ id: 1, role: "judge" });
        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Updated rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        const newerRubricId = Number(newerRubric.lastInsertRowid);
        ctx.drizzle
            .insert(judgingDrafts)
            .values({
                team_id: team.id,
                judge_user_id: 1,
                rubric_version_id: 1,
                scores: { originality: 3 },
                reasoning: "Draft saved against the original rubric.",
                updated_at: new Date(),
            })
            .run();

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: newerRubricId,
            scores: {
                originality: 4,
                presentation: 3,
                technicality: 5,
                theme: 2,
                impact: 4,
            },
            reasoning: "Attempted to finalize against a different rubric.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
        expect(
            ctx.drizzle
                .select()
                .from(teamScores)
                .where(and(eq(teamScores.team_id, team.id), eq(teamScores.judge_user_id, 1)))
                .get(),
        ).toBeUndefined();
        expect(
            ctx.drizzle
                .select()
                .from(judgingDrafts)
                .where(and(eq(judgingDrafts.team_id, team.id), eq(judgingDrafts.judge_user_id, 1)))
                .get()?.rubric_version_id,
        ).toBe(1);
    });

    it("rejects a stale rubric when the judge has no saved draft", async () => {
        vi.mocked(globalThis.requireJudge).mockResolvedValue({ id: 1, role: "judge" });
        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Updated rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        const newerRubricId = Number(newerRubric.lastInsertRowid);
        ctx.drizzle
            .update(seasons)
            .set({ rubric_version_id: newerRubricId })
            .where(eq(seasons.id, 1))
            .run();

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 4,
                presentation: 3,
                technicality: 5,
                theme: 2,
                impact: 4,
            },
            reasoning: "Attempted to submit with an outdated rubric.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
        expect(
            ctx.drizzle
                .select()
                .from(teamScores)
                .where(and(eq(teamScores.team_id, team.id), eq(teamScores.judge_user_id, 1)))
                .get(),
        ).toBeUndefined();
    });

    it("allows finalizing against the pinned draft rubric after an organizer publishes a newer rubric", async () => {
        vi.mocked(globalThis.requireJudge).mockResolvedValue({ id: 1, role: "judge" });
        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Updated rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        ctx.drizzle
            .update(seasons)
            .set({ rubric_version_id: Number(newerRubric.lastInsertRowid) })
            .where(eq(seasons.id, 1))
            .run();
        ctx.drizzle
            .insert(judgingDrafts)
            .values({
                team_id: team.id,
                judge_user_id: 1,
                rubric_version_id: 1,
                scores: { originality: 3 },
                reasoning: "Draft saved against the original rubric.",
                updated_at: new Date(),
            })
            .run();

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 4,
                presentation: 3,
                technicality: 5,
                theme: 2,
                impact: 4,
            },
            reasoning: "Finalized with the rubric used for this draft.",
        };

        await expect(scoresHandler(createEvent())).resolves.toEqual({
            message: "Successfully scored project",
        });
        const score = ctx.drizzle
            .select()
            .from(teamScores)
            .where(and(eq(teamScores.team_id, team.id), eq(teamScores.judge_user_id, 1)))
            .get();
        expect(score?.rubric_version_id).toBe(1);
    });

    it("returns 409 when judge has already scored this team", async () => {
        (globalThis as any).requireJudge.mockResolvedValue({ id: 1, role: "judge" });

        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });

        // Pre-seed a score
        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: team.id,
                judge_user_id: 1,
                scores: "{}",
                reasoning: "Already scored",
            })
            .run();

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 3,
                presentation: 3,
                technicality: 3,
                theme: 3,
                impact: 3,
            },
            reasoning: "Trying to score again.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("returns 409 when scoring is not open", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "in_progress" });
        seedSeason(ctx);
        seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        (globalThis as any).requireJudge.mockResolvedValue({ id: 1, role: "judge" });

        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 3,
                presentation: 3,
                technicality: 3,
                theme: 3,
                impact: 3,
            },
            reasoning: "Not voting phase.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("returns 409 when an organizer closes judging during the voting phase", async () => {
        vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 1, role: "judge" } as any);
        const team = seedTeam(ctx, {
            name: "Target Team",
            project_submitted: 1,
            pathway: "junior",
        });
        ctx.drizzle.update(hackathon).set({ judging_open: 0 }).where(eq(hackathon.id, 1)).run();
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 3,
                presentation: 3,
                technicality: 3,
                theme: 3,
                impact: 3,
            },
            reasoning: "Judging has been closed by the organizer.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("returns 404 for a team that is not in the active season", async () => {
        (globalThis as any).requireJudge.mockResolvedValue({ id: 1, role: "judge" });

        const inactiveSeason = seedSeason(ctx, { name: "Old Season", is_active: 0 });
        const team = seedTeam(ctx, {
            name: "Old Team",
            project_submitted: 1,
            pathway: "junior",
            season_id: inactiveSeason.id,
        });

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 3,
                presentation: 3,
                technicality: 3,
                theme: 3,
                impact: 3,
            },
            reasoning: "Wrong season.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 when the active season changes after the team was loaded", async () => {
        const team = seedTeam(ctx, {
            name: "Team During Season Change",
            project_submitted: 1,
            pathway: "junior",
        });
        const updatedTeam = { ...team, season_id: 2 };
        getTeamMock.mockResolvedValueOnce(updatedTeam);
        prepareScoringRequest(team.id);

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 409 when no season is active, even during the voting phase", async () => {
        const team = seedTeam(ctx, {
            name: "Team Without an Active Season",
            project_submitted: 1,
            pathway: "junior",
        });
        ctx.drizzle.update(seasons).set({ is_active: 0 }).where(eq(seasons.id, 1)).run();
        prepareScoringRequest(team.id);

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "Scoring is not open",
        });
    });

    it("returns 409 when the requested rubric version does not exist in the season", async () => {
        const team = seedTeam(ctx, {
            name: "Team With Missing Rubric",
            project_submitted: 1,
            pathway: "junior",
        });
        prepareScoringRequest(team.id, { rubric_version_id: 999 });

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "The active season has no judging rubric.",
        });
    });

    it("returns 409 when the submitted project has no matching rubric track", async () => {
        const team = seedTeam(ctx, {
            name: "Unmapped Track Team",
            project_submitted: 1,
            pathway: "unconfigured-track",
        });
        prepareScoringRequest(team.id);

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "No rubric track matches this project.",
        });
    });

    it("returns 409 when the submitted project has no pathway", async () => {
        const team = seedTeam(ctx, {
            name: "Unassigned Pathway Team",
            project_submitted: 1,
            pathway: null,
        });
        prepareScoringRequest(team.id);

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "No rubric track matches this project.",
        });
    });

    it("rejects a criterion score outside the configured rubric range", async () => {
        const team = seedTeam(ctx, {
            name: "Invalid Rubric Score Team",
            project_submitted: 1,
            pathway: "junior",
        });
        prepareScoringRequest(team.id, { scores: { ...validScores, originality: 6 } });

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Innovation & Originality must be an integer from 0 to 5.",
        });
    });

    it.each([
        ["23505", "PostgreSQL unique violation"],
        ["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLite primary key constraint"],
        ["1555", "SQLite extended primary key constraint"],
    ])("maps %s (%s) from persistence to an already-scored conflict", async (code) => {
        const team = seedTeam(ctx, {
            name: "Concurrent Scoring Team",
            project_submitted: 1,
            pathway: "junior",
        });
        prepareScoringRequest(team.id);

        const scoreDatabase = await import("~~/server/utils/database/scores");
        const persistenceError = Object.assign(new Error("Duplicate score"), { code });
        expect(scoreDatabase.createTeamScores).toBe(createTeamScoresMock);
        createTeamScoresMock.mockRejectedValueOnce(persistenceError);

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "You already scored this project",
        });
    });

    it("rethrows unexpected score persistence failures unchanged", async () => {
        const team = seedTeam(ctx, {
            name: "Persistence Failure Team",
            project_submitted: 1,
            pathway: "junior",
        });
        prepareScoringRequest(team.id);

        const scoreDatabase = await import("~~/server/utils/database/scores");
        const persistenceError = Object.assign(new Error("Database unavailable"), {
            code: "08006",
        });
        expect(scoreDatabase.createTeamScores).toBe(createTeamScoresMock);
        createTeamScoresMock.mockRejectedValueOnce(persistenceError);

        await expect(scoresHandler(createEvent())).rejects.toBe(persistenceError);
    });

    it("returns 400 when the team has not submitted a project", async () => {
        (globalThis as any).requireJudge.mockResolvedValue({ id: 1, role: "judge" });

        const team = seedTeam(ctx, {
            name: "Unsubmitted Team",
            project_submitted: 0,
            pathway: "junior",
        });

        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            rubric_version_id: 1,
            scores: {
                originality: 3,
                presentation: 3,
                technicality: 3,
                theme: 3,
                impact: 3,
            },
            reasoning: "No submission.",
        };

        await expect(scoresHandler(createEvent())).rejects.toMatchObject({ statusCode: 400 });
    });
});
