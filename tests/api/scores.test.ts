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
