import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockParams,
    resetMockState,
    resetTestContext,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../helpers";
import { adminAuditEvents, users } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock("~~/server/utils/auth", () => ({
    requireUser: auth.requireUser,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();
    handler = (await import("~~/server/api/users/[id]/judge.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    auth.requireUser.mockResolvedValue({ id: 1, is_admin: 1 });
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return { context: { drizzle: ctx.drizzle } };
}

describe("PATCH /api/users/:id/judge", () => {
    it("promotes and demotes a participant and writes an audit record", async () => {
        const participant = seedUser(ctx, { email: "participant@basischina.com" });
        mockParams.values.id = String(participant.id);

        mockBody.value = { is_judge: true };
        await expect(handler(createEvent())).resolves.toEqual({
            id: participant.id,
            is_judge: true,
        });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, participant.id)).get()?.is_judge,
        ).toBe(1);

        mockBody.value = { is_judge: false };
        await expect(handler(createEvent())).resolves.toEqual({
            id: participant.id,
            is_judge: false,
        });

        const audits = ctx.drizzle.select().from(adminAuditEvents).all();
        expect(audits.map((row) => row.action)).toEqual(["user.judge", "user.judge"]);
    });

    it("rejects an unknown user", async () => {
        mockParams.values.id = "999";
        mockBody.value = { is_judge: true };

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("allows promoting a member of a past season team", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past season", is_active: 0 });
        const team = seedTeam(ctx, { name: "Old Team", season_id: pastSeason.id });
        const participant = seedUser(ctx, {
            email: "past@basischina.com",
            team_id: team.id,
        });
        mockParams.values.id = String(participant.id);
        mockBody.value = { is_judge: true };

        await expect(handler(createEvent())).resolves.toEqual({
            id: participant.id,
            is_judge: true,
        });
    });

    it("refuses to promote a competing participant", async () => {
        const season = seedSeason(ctx);
        const team = seedTeam(ctx, { name: "Competing Team", season_id: season.id });
        const participant = seedUser(ctx, {
            email: "participant@basischina.com",
            team_id: team.id,
        });
        mockParams.values.id = String(participant.id);
        mockBody.value = { is_judge: true };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "A competing participant cannot be a judge",
        });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, participant.id)).get()?.is_judge,
        ).toBe(0);
    });

    it("requires an administrator", async () => {
        auth.requireUser.mockRejectedValueOnce(
            Object.assign(new Error("Insufficient permissions"), { statusCode: 403 }),
        );
        mockBody.value = { is_judge: true };

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });
});
