import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
    createTestContext,
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
import { eq } from "drizzle-orm";
import { hackathon, notifications, teamInvites, teams, users } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

const TOKEN = "a".repeat(64);

let ctx: TestContext;
let acceptToken: any;

beforeAll(async () => {
    setupNitroGlobals();
    acceptToken = (await import("~~/server/api/team-invites/token/[token]/accept.post")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
    const user = seedUser(ctx, { email: "invitee@basischina.com" });
    mockSession.value = { user: { id: user.id } };
    mockParams.values = { token: TOKEN };
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function setHackathon(overrides: Record<string, unknown>) {
    ctx.drizzle
        .update(hackathon)
        .set(overrides as any)
        .where(eq(hackathon.id, 1))
        .run();
}

describe("POST /api/team-invites/token/:token/accept", () => {
    it("requires an authenticated user", async () => {
        mockSession.value = undefined;

        await expect(acceptToken(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("refuses a token after submissions close", async () => {
        setHackathon({ status: "voting" });

        await expect(acceptToken(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot join a team after submissions close",
        });
    });

    it("refuses a token while the event is paused", async () => {
        setHackathon({ status: "paused" });

        await expect(acceptToken(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("joins the team, consumes the invite, and notifies the owner", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Inviting Team", owner_user_id: owner.id });
        ctx.drizzle
            .insert(teamInvites)
            .values({
                team_id: team.id,
                email: "invitee@basischina.com",
                invited_by: owner.id,
                token: createHash("sha256").update(TOKEN).digest("hex"),
                expires_at: new Date(Date.now() + 86_400_000),
            })
            .run();

        await expect(acceptToken(createEvent())).resolves.toEqual({
            message: "You joined Inviting Team",
        });

        const invitee = ctx.drizzle
            .select()
            .from(users)
            .where(eq(users.email, "invitee@basischina.com"))
            .get()!;
        expect(invitee.team_id).toBe(team.id);
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(0);
        const notices = ctx.drizzle.select().from(notifications).all();
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            user_id: owner.id,
            type: "team_invite_accepted",
        });
        expect(ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!.status).toBe(
            "active",
        );
    });

    it("uses the invitee email when the account has no display name", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Inviting Team", owner_user_id: owner.id });
        const invitee = ctx.drizzle
            .select()
            .from(users)
            .where(eq(users.email, "invitee@basischina.com"))
            .get()!;
        ctx.drizzle.update(users).set({ name: null }).where(eq(users.id, invitee.id)).run();
        ctx.drizzle
            .insert(teamInvites)
            .values({
                team_id: team.id,
                email: "invitee@basischina.com",
                invited_by: owner.id,
                token: createHash("sha256").update(TOKEN).digest("hex"),
                expires_at: new Date(Date.now() + 86_400_000),
            })
            .run();

        await acceptToken(createEvent());

        const notices = ctx.drizzle.select().from(notifications).all();
        expect(notices[0]!.title).toBe("invitee@basischina.com joined Inviting Team");
    });

    it("rejects an invitation for a team that is no longer active", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, {
            name: "Retired Team",
            owner_user_id: owner.id,
            status: "withdrawn",
        });
        ctx.drizzle
            .insert(teamInvites)
            .values({
                team_id: team.id,
                email: "invitee@basischina.com",
                invited_by: owner.id,
                token: createHash("sha256").update(TOKEN).digest("hex"),
                expires_at: new Date(Date.now() + 86_400_000),
            })
            .run();

        await expect(acceptToken(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "This team is no longer accepting members",
        });
    });

    it("rejects an invitation whose season has ended", async () => {
        const past = seedSeason(ctx, { name: "Past", is_active: 0 });
        const archiver = seedUser(ctx, { email: "archiver@basischina.com" });
        const team = seedTeam(ctx, {
            name: "Old Team",
            season_id: past.id,
            owner_user_id: archiver.id,
        });
        ctx.drizzle
            .insert(teamInvites)
            .values({
                team_id: team.id,
                email: "invitee@basischina.com",
                invited_by: archiver.id,
                token: createHash("sha256").update(TOKEN).digest("hex"),
                expires_at: new Date(Date.now() + 86_400_000),
            })
            .run();

        await expect(acceptToken(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "This invitation is for a season that has ended",
        });
    });
});
