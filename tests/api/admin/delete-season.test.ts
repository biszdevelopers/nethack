import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockParams,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    type TestContext,
} from "../helpers";
import { judgingDrafts, rubricVersions, seasons, teamScores } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let deleteHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);

    deleteHandler = (await import("~~/server/api/admin/seasons/[id]/index.delete")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function gRequireAdmin() {
    return vi.mocked(globalThis.requireAdmin);
}

describe("DELETE /api/admin/seasons/[id]", () => {
    it("requires admin role", async () => {
        gRequireAdmin().mockRejectedValue(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );

        await expect(deleteHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("deletes an empty inactive season and its unreferenced rubric versions", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx, { name: "Current season", is_active: 1 });
        const target = seedSeason(ctx, { name: "Delete Me", is_active: 0 });

        const existing = ctx.drizzle.select().from(seasons).where(eq(seasons.id, target.id)).get();
        expect(existing).not.toBeNull();

        mockParams.values["id"] = String(target.id);
        const result = await deleteHandler(createEvent());

        expect(result.seasons.find((s: any) => s.id === target.id)).toBeUndefined();

        const deleted = ctx.drizzle.select().from(seasons).where(eq(seasons.id, target.id)).get();
        expect(deleted).toBeUndefined();
        expect(
            ctx.drizzle
                .select()
                .from(rubricVersions)
                .where(eq(rubricVersions.season_id, target.id))
                .all(),
        ).toEqual([]);
    });

    it("deletes an empty inactive season that has no rubric versions", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx, { name: "Current season", is_active: 1 });
        const target = seedSeason(ctx, { name: "Legacy empty season", is_active: 0 });
        ctx.drizzle
            .update(seasons)
            .set({ rubric_version_id: null })
            .where(eq(seasons.id, target.id))
            .run();
        ctx.drizzle.delete(rubricVersions).where(eq(rubricVersions.season_id, target.id)).run();
        mockParams.values.id = String(target.id);

        const result = await deleteHandler(createEvent());

        expect(result.seasons.find((season: any) => season.id === target.id)).toBeUndefined();
    });

    it.each(["score", "draft"] as const)(
        "preserves an inactive season referenced by judging %s history",
        async (historyType) => {
            gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
            const currentSeason = seedSeason(ctx, { name: "Current season", is_active: 1 });
            const target = seedSeason(ctx, { name: "Judged season", is_active: 0 });
            const team = seedTeam(ctx, { season_id: currentSeason.id });
            const judge = seedUser(ctx, { email: `judge-${historyType}@basischina.com` });

            if (historyType === "score") {
                ctx.drizzle
                    .insert(teamScores)
                    .values({
                        team_id: team.id,
                        judge_user_id: judge.id,
                        season_id: target.id,
                        rubric_version_id: target.rubric_version_id!,
                        scores: "{}",
                    })
                    .run();
            } else {
                ctx.drizzle
                    .insert(judgingDrafts)
                    .values({
                        team_id: team.id,
                        judge_user_id: judge.id,
                        rubric_version_id: target.rubric_version_id!,
                        scores: {},
                        updated_at: new Date(),
                    })
                    .run();
            }

            mockParams.values.id = String(target.id);

            await expect(deleteHandler(createEvent())).rejects.toMatchObject({
                statusCode: 409,
                message: "This season contains team or judging history and cannot be deleted.",
            });
            expect(
                ctx.drizzle.select().from(seasons).where(eq(seasons.id, target.id)).get(),
            ).toBeDefined();
        },
    );

    it("preserves the active season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        const active = seedSeason(ctx, { name: "Current season", is_active: 1 });
        mockParams.values.id = String(active.id);

        await expect(deleteHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "The active season cannot be deleted.",
        });
        expect(
            ctx.drizzle.select().from(seasons).where(eq(seasons.id, active.id)).get(),
        ).toBeDefined();
    });

    it("preserves inactive seasons that contain team history", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });
        seedSeason(ctx, { name: "Current season", is_active: 1 });
        const target = seedSeason(ctx, { name: "Archived season", is_active: 0 });
        seedTeam(ctx, { season_id: target.id });
        mockParams.values.id = String(target.id);

        await expect(deleteHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "This season contains team or judging history and cannot be deleted.",
        });
        expect(
            ctx.drizzle.select().from(seasons).where(eq(seasons.id, target.id)).get(),
        ).toBeDefined();
    });

    it("returns 404 for non-existent season", async () => {
        gRequireAdmin().mockResolvedValue({ id: 1, role: "admin" });

        mockParams.values["id"] = "999";
        await expect(deleteHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});
