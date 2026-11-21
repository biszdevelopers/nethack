import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createTestContext,
    mockBody,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { adminAuditEvents, hackathon, notifications, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
    writeHackathonConfig: vi.fn(),
    useYaml: vi.fn(),
    readFailure: false,
}));

vi.mock("~~/server/utils/hackathon-config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/hackathon-config")>();
    return {
        ...actual,
        writeHackathonConfig: mocks.writeHackathonConfig,
        readHackathonConfig: (...args: Parameters<typeof actual.readHackathonConfig>) => {
            if (mocks.readFailure) {
                mocks.readFailure = false;
                return Promise.reject(new Error("manifest unreadable"));
            }
            return actual.readHackathonConfig(...args);
        },
        hackathonUsesYaml: () =>
            mocks.useYaml.getMockImplementation()
                ? (mocks.useYaml() as boolean)
                : actual.hackathonUsesYaml(),
    };
});

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

const manifest = `id: 1
status: in_progress
voting_enabled: 0
results_published: 0
show_scores: 0
show_ranking: 0
submitted_count: 0
max_votes_per_user: 0
judging_open: 0
schedule_start: null
schedule_end: null
start_timestamp: 0
end_timestamp: 0
voting_start_timestamp: 0
voting_end_timestamp: 0
results_open_timestamp: 0
theme_name: null
theme_description: null
`;

let ctx: TestContext;
let patchHandler: any;
let manifestDirectory: string;
let manifestPath: string;

beforeAll(async () => {
    setupNitroGlobals();
    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getSeasons", seasonsDb.getSeasons);
    patchHandler = (await import("~~/server/api/admin/hackathon/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    mocks.writeHackathonConfig.mockReset().mockResolvedValue(undefined);
    mocks.useYaml.mockReset();
    manifestDirectory = mkdtempSync(join(tmpdir(), "basishacks-manifest-failures-"));
    manifestPath = join(manifestDirectory, "HACKATHON.yml");
    writeFileSync(manifestPath, manifest);
    vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
    vi.stubEnv("HACKATHON_CONFIG_PATH", manifestPath);
    ctx = await createTestContext();
    const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
    vi.unstubAllEnvs();
    rmSync(manifestDirectory, { recursive: true, force: true });
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

describe("PATCH /api/admin/hackathon manifest publication", () => {
    it("freezes live results through the manifest and records the snapshot", async () => {
        seedHackathon(ctx);
        ctx.sqlite.prepare("UPDATE hackathon SET live_overrides = 'null' WHERE id = 1").run();
        const season = seedSeason(ctx);
        seedTeam(ctx, { name: "Project", project_submitted: 1, season_id: season.id });
        mockBody.value = { results_published: 1 };

        const result = await patchHandler(createEvent());

        expect(result.hackathon.results_published).toBe(1);
        const row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, season.id)).get()!;
        expect(row).toMatchObject({ results_published: 1, judging_open: 0, voting_enabled: 0 });
        expect(row.results_published_at).toBeInstanceOf(Date);
        expect(row.results_snapshot).toMatchObject({
            season_id: season.id,
            standings: [{ name: "Project" }],
        });
        expect(ctx.drizzle.select().from(adminAuditEvents).all()).toHaveLength(1);
        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("honours explicit judging and voting switches while publishing", async () => {
        seedHackathon(ctx);
        const season = seedSeason(ctx);
        mockBody.value = { results_published: 1, judging_open: 1, voting_enabled: 1 };

        await patchHandler(createEvent());

        const row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, season.id)).get()!;
        expect(row).toMatchObject({ results_published: 1, judging_open: 1, voting_enabled: 1 });
    });

    it("does not republish or renotify a season whose results are already live", async () => {
        seedHackathon(ctx);
        const season = seedSeason(ctx, { results_published: 1, results_published_at: new Date() });
        mockBody.value = { results_published: 1 };

        await patchHandler(createEvent());

        const row = ctx.drizzle.select().from(seasons).where(eq(seasons.id, season.id)).get()!;
        expect(row.results_published_at).toEqual(season.results_published_at);
        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("rejects a live update when the live settings row is missing", async () => {
        mockBody.value = { status: "finished" };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Live settings not found",
        });
    });
});

describe("PATCH /api/admin/hackathon historical season in manifest mode", () => {
    it("publishes a historical season and notifies its participants", async () => {
        seedHackathon(ctx);
        seedSeason(ctx);
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const team = seedTeam(ctx, {
            name: "Past Project",
            season_id: past.id,
            project_submitted: 1,
        });
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        mockBody.value = { season_id: past.id, results_published: 1 };

        const result = await patchHandler(createEvent());

        expect(result.seasons.find((season: any) => season.id === past.id)).toMatchObject({
            results_published: 1,
        });
        const notices = ctx.drizzle.select().from(notifications).all();
        expect(notices).toMatchObject([{ user_id: member.id, type: "results_published" }]);
        const audit = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audit[0]).toMatchObject({
            action: "season.update",
            entity_id: String(past.id),
        });
    });

    it("skips the notification when the historical season was already published", async () => {
        seedHackathon(ctx);
        seedSeason(ctx);
        const past = seedSeason(ctx, {
            name: "Past",
            is_active: 0,
            results_published: 1,
            results_published_at: new Date(),
        });
        mockBody.value = { season_id: past.id, results_published: 1 };

        await patchHandler(createEvent());

        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("rejects a historical update when the season does not exist", async () => {
        seedHackathon(ctx);
        seedSeason(ctx);
        mockBody.value = { season_id: 999, status: "finished" };

        await expect(patchHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("requires a season id when the target is not the live settings", async () => {
        seedHackathon(ctx);
        mockBody.value = { status: "finished" };
        mocks.useYaml.mockReturnValueOnce(false).mockReturnValueOnce(true);

        await expect(patchHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "season_id is required",
        });
    });

    it("treats a manifest that flipped away from YAML as absent", async () => {
        seedHackathon(ctx);
        seedSeason(ctx);
        mockBody.value = { status: "finished" };
        mocks.useYaml.mockReturnValueOnce(true).mockReturnValueOnce(false);

        await expect(patchHandler(createEvent())).resolves.toHaveProperty("hackathon");
    });

    it("continues when the local manifest cannot be read", async () => {
        mocks.readFailure = true;
        seedHackathon(ctx);
        seedSeason(ctx);
        mockBody.value = { status: "finished" };

        await expect(patchHandler(createEvent())).resolves.toHaveProperty("hackathon");
    });
});

describe("PATCH /api/admin/hackathon manifest write rollback", () => {
    it("restores the season and live rows when the manifest write fails", async () => {
        seedHackathon(ctx, { theme_name: "Original" });
        const season = seedSeason(ctx);
        mocks.writeHackathonConfig.mockRejectedValueOnce(new Error("disk full"));
        mockBody.value = { theme_name: "Broken" };

        await expect(patchHandler(createEvent())).rejects.toThrow("disk full");

        expect(
            ctx.drizzle.select().from(seasons).where(eq(seasons.id, season.id)).get()!.theme_name,
        ).toBeNull();
        expect(
            ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get()!.theme_name,
        ).toBe("Original");
        expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
    });

    it("restores live rows when no season is active", async () => {
        seedHackathon(ctx, { theme_name: "Original" });
        mocks.writeHackathonConfig.mockRejectedValueOnce(new Error("disk full"));
        mockBody.value = { theme_name: "Broken" };

        await expect(patchHandler(createEvent())).rejects.toThrow("disk full");

        expect(ctx.drizzle.select().from(seasons).all()).toHaveLength(0);
        expect(
            ctx.drizzle.select().from(hackathon).where(eq(hackathon.id, 1)).get()!.theme_name,
        ).toBe("Original");
    });

    it("preserves the manifest error when the rollback transaction also fails", async () => {
        seedHackathon(ctx);
        seedSeason(ctx);
        mocks.writeHackathonConfig.mockRejectedValueOnce(new Error("manifest offline"));
        mockBody.value = { theme_name: "Broken" };
        const realDrizzle = ctx.drizzle as any;
        let transactions = 0;
        const flakyDrizzle = new Proxy(realDrizzle, {
            get(target, property) {
                if (property === "transaction") {
                    return async (callback: any) => {
                        transactions += 1;
                        if (transactions === 1) return target.transaction(callback);
                        throw new Error("rollback unavailable");
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        await expect(
            patchHandler(createEvent({ context: { drizzle: flakyDrizzle } })),
        ).rejects.toThrow("manifest offline");
        expect(transactions).toBe(2);
    });
});
