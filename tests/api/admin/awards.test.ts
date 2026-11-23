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
} from "../helpers";
import { adminAuditEvents, awards, teamAwards } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listAwards: any;
let createAward: any;
let deleteAward: any;
let teamAwardsList: any;
let teamAwardsAdd: any;
let teamAwardsRemove: any;

beforeAll(async () => {
    setupNitroGlobals();
    listAwards = (await import("~~/server/api/admin/awards/index.get")).default;
    createAward = (await import("~~/server/api/admin/awards/index.post")).default;
    deleteAward = (await import("~~/server/api/admin/awards/[namespace].delete")).default;
    teamAwardsList = (await import("~~/server/api/admin/teams/[id]/awards/index.get")).default;
    teamAwardsAdd = (await import("~~/server/api/admin/teams/[id]/awards/index.post")).default;
    teamAwardsRemove = (await import("~~/server/api/admin/teams/[id]/awards/[award].delete"))
        .default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
    const admin = seedUser(ctx, { email: "admin@basischina.com", is_admin: 1 });
    mockSession.value = { user: { id: admin.id } };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function seedAward(namespace = "gold", name = "Gold") {
    return ctx.drizzle
        .insert(awards)
        .values({ namespace, name, description: `${name} award`, icon: "trophy", color: "gold" })
        .returning()
        .get();
}

describe("GET /api/admin/awards", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;

        await expect(listAwards(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("lists awards ordered by namespace", async () => {
        seedAward("gold", "Gold");
        seedAward("best-design", "Best Design");

        const result = await listAwards(createEvent());

        expect(result.awards.map((award: any) => award.namespace)).toEqual(["best-design", "gold"]);
    });

    it("returns an empty list when no awards exist", async () => {
        await expect(listAwards(createEvent())).resolves.toEqual({ awards: [] });
    });
});

describe("POST /api/admin/awards", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockBody.value = { namespace: "gold", name: "Gold", icon: "trophy" };

        await expect(createAward(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("creates an award with the supplied presentation fields and audits the write", async () => {
        mockBody.value = {
            namespace: "gold",
            name: "Gold",
            description: "",
            icon: "trophy",
            color: "gold",
        };

        const result = await createAward(createEvent());

        expect(result.award).toMatchObject({
            namespace: "gold",
            name: "Gold",
            icon: "trophy",
            color: "gold",
            description: "",
        });
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "award.upsert",
            entity_type: "award",
            entity_id: "gold",
        });
    });

    it("updates an existing award namespace in place", async () => {
        mockBody.value = {
            namespace: "gold",
            name: "Gold",
            description: "",
            icon: "trophy",
            color: "gold",
        };
        await createAward(createEvent());
        mockBody.value = {
            namespace: "gold",
            name: "Platinum",
            description: "Upgraded",
            icon: "star",
            color: "silver",
        };

        await createAward(createEvent());

        const rows = ctx.drizzle.select().from(awards).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            name: "Platinum",
            description: "Upgraded",
            icon: "star",
            color: "silver",
        });
        expect(ctx.drizzle.select().from(adminAuditEvents).all()).toHaveLength(2);
    });
});

describe("DELETE /api/admin/awards/:namespace", () => {
    it("requires an authenticated administrator", async () => {
        mockSession.value = undefined;
        mockParams.values = { namespace: "gold" };

        await expect(deleteAward(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("deletes an award and records the removed row", async () => {
        seedAward("gold", "Gold");
        mockParams.values = { namespace: "gold" };

        await expect(deleteAward(createEvent())).resolves.toEqual({ message: "Award deleted" });

        expect(ctx.drizzle.select().from(awards).all()).toHaveLength(0);
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: "award.delete",
            entity_id: "gold",
            before: { namespace: "gold" },
        });
    });

    it("returns 404 for an unknown award", async () => {
        mockParams.values = { namespace: "missing" };

        await expect(deleteAward(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("maps a foreign-key conflict to 409", async () => {
        seedAward("gold", "Gold");
        mockParams.values = { namespace: "gold" };
        const originalDelete = ctx.drizzle.delete;
        (ctx.drizzle as any).delete = () => ({
            where: () => ({
                returning: () =>
                    Promise.reject(Object.assign(new Error("conflict"), { code: "23503" })),
            }),
        });

        try {
            await expect(deleteAward(createEvent())).rejects.toMatchObject({
                statusCode: 409,
                message: "Award is still assigned to a team",
            });
        } finally {
            (ctx.drizzle as any).delete = originalDelete;
        }
    });

    it("rethrows unrelated database failures", async () => {
        mockParams.values = { namespace: "gold" };
        const originalDelete = ctx.drizzle.delete;
        (ctx.drizzle as any).delete = () => ({
            where: () => ({
                returning: () => Promise.reject(new Error("connection lost")),
            }),
        });

        try {
            await expect(deleteAward(createEvent())).rejects.toThrow("connection lost");
        } finally {
            (ctx.drizzle as any).delete = originalDelete;
        }
    });
});

describe("team awards administration", () => {
    function seedTeamWithAwards() {
        const team = seedTeam(ctx, { name: "Award Team" });
        const award = seedAward("gold", "Gold");
        return { team, award };
    }

    it("lists the awards resolved for one team", async () => {
        const { team } = seedTeamWithAwards();
        ctx.drizzle
            .insert(teamAwards)
            .values({ team_id: team.id, award: "gold", meta: JSON.stringify({ note: "best" }) })
            .run();
        mockParams.values = { id: team.id };

        const result = await teamAwardsList(createEvent());

        expect(result.awards).toHaveLength(1);
        expect(result.awards[0]).toMatchObject({
            team_id: team.id,
            namespace: "gold",
            name: "Gold",
            meta: { note: "best" },
            text: "Gold award",
        });
    });

    it("returns 404 when listing awards for an unknown team", async () => {
        mockParams.values = { id: 999 };

        await expect(teamAwardsList(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("assigns an award and audits it", async () => {
        const { team } = seedTeamWithAwards();
        mockParams.values = { id: team.id };
        mockBody.value = { award: "gold", meta: { place: 1 } };

        await expect(teamAwardsAdd(createEvent())).resolves.toEqual({ message: "Award assigned" });

        const rows = ctx.drizzle.select().from(teamAwards).all();
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0]!.meta)).toEqual({ place: 1 });
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits[0]).toMatchObject({
            action: "team.award.add",
            entity_type: "team",
            entity_id: String(team.id),
        });
    });

    it("defaults the meta payload when it is omitted", async () => {
        const { team } = seedTeamWithAwards();
        mockParams.values = { id: team.id };
        mockBody.value = { award: "gold" };

        await teamAwardsAdd(createEvent());

        expect(ctx.drizzle.select().from(teamAwards).all()[0]!.meta).toBe("{}");
    });

    it("rejects an unknown team or award", async () => {
        const { team } = seedTeamWithAwards();
        mockParams.values = { id: 999 };
        mockBody.value = { award: "gold" };
        await expect(teamAwardsAdd(createEvent())).rejects.toMatchObject({ statusCode: 404 });

        mockParams.values = { id: team.id };
        mockBody.value = { award: "missing" };
        await expect(teamAwardsAdd(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects assigning the same award twice", async () => {
        const { team } = seedTeamWithAwards();
        mockParams.values = { id: team.id };
        mockBody.value = { award: "gold" };
        await teamAwardsAdd(createEvent());

        await expect(teamAwardsAdd(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Team already has this award.",
        });
    });

    it("removes one award assignment and audits it", async () => {
        const { team } = seedTeamWithAwards();
        ctx.drizzle
            .insert(teamAwards)
            .values({ team_id: team.id, award: "gold", meta: "{}" })
            .run();
        mockParams.values = { id: team.id, award: "gold" };

        await expect(teamAwardsRemove(createEvent())).resolves.toEqual({
            message: "Award removed",
        });

        expect(ctx.drizzle.select().from(teamAwards).all()).toHaveLength(0);
        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits[0]).toMatchObject({
            action: "team.award.remove",
            entity_id: String(team.id),
            before: { award: "gold" },
        });
    });

    it("returns 404 when removing an assignment that does not exist", async () => {
        const { team } = seedTeamWithAwards();
        mockParams.values = { id: team.id, award: "gold" };

        await expect(teamAwardsRemove(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Team award not found.",
        });
    });
});
