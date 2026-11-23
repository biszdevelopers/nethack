import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { adminAuditEvents, rubricVersions, seasons } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let createSeason: any;

beforeAll(async () => {
    setupNitroGlobals();
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);
    createSeason = (await import("~~/server/api/admin/seasons/index.post")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx, {
        theme_name: "Theme",
        theme_description: "Description",
        start_timestamp: 100,
        end_timestamp: 200,
    });
    const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

describe("POST /api/admin/seasons rubric copy", () => {
    it("copies the active rubric and schedule into the new season", async () => {
        mockBody.value = { name: "Copied Season" };

        const result = await createSeason(createEvent());

        const created = result.seasons.find((season: any) => season.name === "Copied Season");
        expect(created).toMatchObject({
            theme_name: "Theme",
            theme_description: "Description",
            start_timestamp: 100,
            end_timestamp: 200,
            is_active: 0,
            status: "not_started",
        });
        expect(created.rubric_version_id).toEqual(expect.any(Number));
        const versions = ctx.drizzle
            .select()
            .from(rubricVersions)
            .all()
            .filter((version) => version.season_id === created.id);
        expect(versions).toHaveLength(1);
        expect(versions[0]).toMatchObject({ version: 1, name: "Test rubric" });
        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]).toMatchObject({
            action: "season.create",
            entity_type: "season",
            entity_id: String(created.id),
            after: { name: "Copied Season", copied_schedule: true, rubric_copied: true },
        });
    });

    it("creates and activates a season when requested", async () => {
        mockBody.value = { name: "Live Season", is_active: 1 };

        const result = await createSeason(createEvent());

        const created = result.seasons.find((season: any) => season.name === "Live Season");
        expect(created).toMatchObject({ is_active: 1, is_blank_start: 0 });
    });

    it("creates a blank season without copying the rubric or schedule", async () => {
        mockBody.value = { name: "Blank Season", copy_live_settings: false };

        const result = await createSeason(createEvent());

        const created = result.seasons.find((season: any) => season.name === "Blank Season");
        expect(created).toMatchObject({ is_blank_start: 1, rubric_version_id: null });
        expect(created.theme_name).toBeNull();
        expect(
            ctx.drizzle
                .select()
                .from(rubricVersions)
                .all()
                .filter((version) => version.season_id === created.id),
        ).toHaveLength(0);
        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]!.after).toMatchObject({
            copied_schedule: false,
            rubric_copied: false,
        });
    });

    it("reports an audit write for every created season", async () => {
        mockBody.value = { name: "First Copy" };
        await createSeason(createEvent());
        mockBody.value = { name: "Second Copy" };
        await createSeason(createEvent());

        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(2);
        expect(audits.map((row) => row.entity_id).sort()).toEqual(
            ctx.drizzle
                .select()
                .from(seasons)
                .all()
                .filter((season) => season.name.endsWith("Copy"))
                .map((season) => String(season.id))
                .sort(),
        );
    });
});
