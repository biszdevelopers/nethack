import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockParams,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { judgingDrafts, teamScores } from "~~/server/database/schema";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { clearRateLimitHistory, JUDGING_DRAFT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const basisAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("~~/server/utils/basis-auth-session", () => ({
    readBasisAuthUserSession: basisAuthSessionMock,
}));

let ctx: TestContext;
let judgeId: number;
let teamId: number;
let originalRubricId: number;
let saveDraftHandler: any;
let getDraftHandler: any;
let deleteDraftHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const hackathonDb = await import("~~/server/utils/database/hackathon");
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);
    saveDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].put")).default;
    getDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].get")).default;
    deleteDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].delete")).default;
});

beforeEach(async () => {
    resetMockState();
    clearRateLimitHistory();
    basisAuthSessionMock.mockImplementation(() => {
        const userId = mockSession.value?.user?.id;
        return userId ? { userId } : undefined;
    });
    vi.stubGlobal("setHeader", vi.fn());
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "voting", judging_open: 1 });
    const season = seedSeason(ctx);
    originalRubricId = season.rubric_version_id!;
    judgeId = seedUser(ctx, { email: "judge@basischina.com", role: "judge" }).id;
    teamId = seedTeam(ctx, { project_submitted: 1, pathway: "junior" }).id;
    mockSession.value = { user: { id: judgeId } };
    mockParams.values.teamId = String(teamId);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return {
        context: { drizzle: ctx.drizzle },
        node: { req: { socket: { remoteAddress: "127.0.0.1" } } },
    };
}

describe("judging draft rubric recovery", () => {
    it("rate limits draft reads, writes, and deletes per judge with a retry header", async () => {
        for (
            let request = 0;
            request < JUDGING_DRAFT_RATE_LIMIT_CONFIG.maxRequests - 1;
            request++
        ) {
            await deleteDraftHandler(createEvent());
        }

        mockBody.value = {
            scores: { originality: 4 },
            reasoning: "Autosave stays within the judge's draft request budget.",
            rubric_version_id: originalRubricId,
        };
        await expect(saveDraftHandler(createEvent())).resolves.toMatchObject({ saved: true });

        await expect(getDraftHandler(createEvent())).rejects.toMatchObject({
            statusCode: 429,
            statusMessage: "Too Many Requests",
        });
        expect((globalThis as any).setHeader).toHaveBeenCalledWith(
            expect.anything(),
            "Retry-After",
            expect.any(Number),
        );

        const otherJudgeId = seedUser(ctx, {
            email: "other-judge@basischina.com",
            role: "judge",
        }).id;
        mockSession.value = { user: { id: otherJudgeId } };
        await expect(getDraftHandler(createEvent())).resolves.toMatchObject({ draft: null });
    });

    it("saves a draft against the rubric the judge opened after an organizer publishes a new version", async () => {
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Updated rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        ctx.sqlite
            .prepare("UPDATE seasons SET rubric_version_id = ? WHERE id = 1")
            .run(Number(newerRubric.lastInsertRowid));

        mockBody.value = {
            scores: { originality: 4 },
            reasoning: "Saved against the rubric already shown to this judge.",
            rubric_version_id: originalRubricId,
        };

        await expect(saveDraftHandler(createEvent())).resolves.toMatchObject({
            saved: true,
            rubric_version_id: originalRubricId,
        });

        const saved = ctx.drizzle
            .select()
            .from(judgingDrafts)
            .where(and(eq(judgingDrafts.team_id, teamId), eq(judgingDrafts.judge_user_id, judgeId)))
            .get();
        expect(saved?.rubric_version_id).toBe(originalRubricId);
        expect(saved?.scores).toEqual({ originality: 4 });

        const recovered = await getDraftHandler(createEvent());
        expect(recovered.rubric.version_id).toBe(originalRubricId);
        expect(recovered.draft).toMatchObject({
            scores: { originality: 4 },
            reasoning: "Saved against the rubric already shown to this judge.",
            rubric_version_id: originalRubricId,
        });
    });

    it("does not let a draft switch to a different rubric version after it is pinned", async () => {
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Updated rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        mockBody.value = {
            scores: { originality: 3 },
            reasoning: "Initial draft.",
            rubric_version_id: originalRubricId,
        };
        await saveDraftHandler(createEvent());

        mockBody.value = {
            scores: { originality: 5 },
            reasoning: "Attempt to switch the pinned version.",
            rubric_version_id: Number(newerRubric.lastInsertRowid),
        };
        await expect(saveDraftHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: "This draft is pinned to another rubric.",
        });

        const saved = ctx.drizzle.select().from(judgingDrafts).get();
        expect(saved?.rubric_version_id).toBe(originalRubricId);
        expect(saved?.scores).toEqual({ originality: 3 });
    });

    it("blocks draft saves after an organizer closes judging", async () => {
        ctx.sqlite.prepare("UPDATE hackathon SET judging_open = 0 WHERE id = 1").run();
        mockBody.value = {
            scores: { originality: 4 },
            reasoning: "Keep this partial feedback safe while judging is open.",
            rubric_version_id: originalRubricId,
        };

        await expect(saveDraftHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
        expect(ctx.drizzle.select().from(judgingDrafts).get()).toBeUndefined();
    });

    it("keeps the finalized rubric authoritative if a stale draft could not be cleared", async () => {
        const newerRubric = ctx.sqlite
            .prepare(
                "INSERT INTO rubric_versions (season_id, version, name, definition) VALUES (?, ?, ?, ?)",
            )
            .run(1, 2, "Finalized rubric", JSON.stringify(DEFAULT_RUBRIC_DEFINITION));
        const finalizedRubricId = Number(newerRubric.lastInsertRowid);
        ctx.drizzle
            .insert(judgingDrafts)
            .values({
                team_id: teamId,
                judge_user_id: judgeId,
                rubric_version_id: originalRubricId,
                scores: { originality: 1 },
                reasoning: "Stale pre-finalization draft",
                updated_at: new Date(),
            })
            .run();
        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: teamId,
                judge_user_id: judgeId,
                season_id: 1,
                rubric_version_id: finalizedRubricId,
                scores: JSON.stringify({ originality: 5 }),
                reasoning: "Finalized feedback",
            })
            .run();

        const recovered = await getDraftHandler(createEvent());

        expect(recovered.rubric.version_id).toBe(finalizedRubricId);
        expect(recovered.draft).toBeNull();
    });

    it("does not allow a judge to save a new draft after finalizing", async () => {
        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: teamId,
                judge_user_id: judgeId,
                season_id: 1,
                rubric_version_id: originalRubricId,
                scores: JSON.stringify({ originality: 5 }),
                reasoning: "Finalized feedback",
            })
            .run();
        mockBody.value = {
            scores: { originality: 4 },
            reasoning: "Attempt to create a draft after finalizing.",
            rubric_version_id: originalRubricId,
        };

        await expect(saveDraftHandler(createEvent())).rejects.toMatchObject({ statusCode: 409 });
        expect(ctx.drizzle.select().from(judgingDrafts).get()).toBeUndefined();
    });
});
