import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "../../helpers";
import { eq } from "drizzle-orm";
import {
    adminAuditEvents,
    teamScores,
    teams,
    userPastTeams,
    users,
} from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let transferOwner: any;
let disband: any;

beforeAll(async () => {
    setupNitroGlobals();
    transferOwner = (await import("~~/server/api/teams/[id]/owner.patch")).default;
    disband = (await import("~~/server/api/teams/[id]/index.delete")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
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

function seedOwnedTeam(name: string) {
    const owner = seedUser(ctx, { email: "owner@basischina.com", team_id: null });
    const team = seedTeam(ctx, { name, owner_user_id: owner.id });
    ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
    return { owner, team };
}

describe("PATCH /api/teams/:id/owner", () => {
    it("hands ownership to another current member", async () => {
        const { owner, team } = seedOwnedTeam("Transfer Team");
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { user_id: member.id };

        await expect(transferOwner(createEvent())).resolves.toEqual({
            message: "Team ownership transferred",
        });
        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.owner_user_id).toBe(member.id);
    });

    it("rejects a non-owner member", async () => {
        const { team } = seedOwnedTeam("Transfer Team");
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        const other = seedUser(ctx, { email: "other@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: member.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { user_id: other.id };

        await expect(transferOwner(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can transfer ownership",
        });
    });

    it("rejects a target who is not a current member", async () => {
        const { owner, team } = seedOwnedTeam("Transfer Team");
        const outsider = seedUser(ctx, { email: "outsider@basischina.com" });

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { user_id: outsider.id };

        await expect(transferOwner(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "That user is not a current member of this team",
        });
    });

    it("rejects a transfer after submission", async () => {
        const { owner, team } = seedOwnedTeam("Submitted Team");
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        ctx.drizzle.update(teams).set({ project_submitted: 1 }).where(eq(teams.id, team.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { user_id: member.id };

        await expect(transferOwner(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Cannot transfer ownership after the project is submitted",
        });
    });
});

describe("DELETE /api/teams/:id", () => {
    it("withdraws the team, clears members, and keeps history", async () => {
        const { owner, team } = seedOwnedTeam("Disband Team");
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        ctx.drizzle.insert(userPastTeams).values({ user_id: owner.id, team_id: team.id }).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);

        await expect(disband(createEvent())).resolves.toEqual({ message: "Team disbanded" });

        const updated = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(updated!.status).toBe("withdrawn");
        const members = ctx.drizzle.select().from(users).where(eq(users.team_id, team.id)).all();
        expect(members).toHaveLength(0);
        const history = ctx.drizzle
            .select()
            .from(userPastTeams)
            .where(eq(userPastTeams.team_id, team.id))
            .all();
        expect(history.map((row) => row.user_id).sort()).toEqual([owner.id, member.id].sort());
        expect(ctx.drizzle.select().from(adminAuditEvents).all()).toHaveLength(1);
    });

    it("rejects a non-owner member", async () => {
        const { team } = seedOwnedTeam("Disband Team");
        const member = seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: member.id } };
        mockParams.values["id"] = String(team.id);

        await expect(disband(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can disband it",
        });
    });

    it("rejects a team that already submitted", async () => {
        const { owner, team } = seedOwnedTeam("Submitted Team");
        ctx.drizzle.update(teams).set({ project_submitted: 1 }).where(eq(teams.id, team.id)).run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);

        await expect(disband(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Cannot disband a team after its project is submitted",
        });
    });

    it("rejects a team that already has judge scores", async () => {
        const { owner, team } = seedOwnedTeam("Judged Team");
        const judge = seedUser(ctx, { email: "judge@basischina.com" });
        ctx.drizzle
            .insert(teamScores)
            .values({
                team_id: team.id,
                judge_user_id: judge.id,
                season_id: team.season_id,
                scores: "{}",
            } as any)
            .run();

        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);

        await expect(disband(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Cannot disband a team that already has judge scores",
        });
    });
});
