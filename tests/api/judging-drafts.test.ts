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
import { judgingDrafts } from "~~/server/database/schema";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

let ctx: TestContext;
let judgeId: number;
let teamId: number;
let originalRubricId: number;
let saveDraftHandler: any;
let getDraftHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const hackathonDb = await import("~~/server/utils/database/hackathon");
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);
    saveDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].put")).default;
    getDraftHandler = (await import("~~/server/api/judging/drafts/[teamId].get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "voting" });
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
    return { context: { drizzle: ctx.drizzle } };
}

describe("judging draft rubric recovery", () => {
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
});
