import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "./helpers";
import { eq } from "drizzle-orm";
import { teamInvites, teams, users } from "~~/server/database/schema";
import { MAX_TEAM_MEMBERS } from "~~/shared/schemas";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listTeamInvites: any;
let cancelTeamInvite: any;
let listMyInvites: any;
let acceptInvite: any;
let declineInvite: any;

beforeAll(async () => {
    setupNitroGlobals();

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("getTeamInvites", membersDb.getTeamInvites);
    vi.stubGlobal("getInvitesForEmail", membersDb.getInvitesForEmail);
    vi.stubGlobal("createTeamInvite", membersDb.createTeamInvite);
    vi.stubGlobal("deleteTeamInvite", membersDb.deleteTeamInvite);
    vi.stubGlobal("acceptTeamInvite", membersDb.acceptTeamInvite);
    vi.stubGlobal("declineTeamInvite", membersDb.declineTeamInvite);
    vi.stubGlobal("getTeamMembers", membersDb.getTeamMembers);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);

    listTeamInvites = (await import("~~/server/api/teams/[id]/invites/index.get")).default;
    cancelTeamInvite = (await import("~~/server/api/teams/[id]/invites/[invite].delete")).default;
    listMyInvites = (await import("~~/server/api/team-invites/index.get")).default;
    acceptInvite = (await import("~~/server/api/team-invites/[id]/accept.post")).default;
    declineInvite = (await import("~~/server/api/team-invites/[id]/index.delete")).default;
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

function invite(teamID: number, email: string, invitedBy = 1) {
    return ctx.drizzle
        .insert(teamInvites)
        .values({
            team_id: teamID,
            email: email.toLowerCase(),
            invited_by: invitedBy,
            created_at: new Date(),
        })
        .returning()
        .get();
}

describe("GET /api/teams/:id/invites", () => {
    it("lists pending invitations for team members", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        invite(team.id, "One@basischina.com");
        invite(team.id, "two@basischina.com");
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);

        await expect(listTeamInvites(createEvent())).resolves.toEqual({
            invites: [
                { id: 1, email: "one@basischina.com" },
                { id: 2, email: "two@basischina.com" },
            ],
        });
    });

    it("rejects non-members", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const otherTeam = seedTeam(ctx, { name: "Other" });
        seedUser(ctx, { email: "outsider@basischina.com", team_id: otherTeam.id });
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);

        await expect(listTeamInvites(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe("DELETE /api/teams/:id/invites/:invite", () => {
    it("cancels a pending invitation", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["invite"] = String(created.id);

        await expect(cancelTeamInvite(createEvent())).resolves.toEqual({
            message: "Invitation cancelled",
        });
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(0);
    });

    it("rejects non-members and unknown invitations", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const otherTeam = seedTeam(ctx, { name: "Other" });
        seedUser(ctx, { email: "outsider@basischina.com", team_id: otherTeam.id });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["invite"] = String(created.id);

        await expect(cancelTeamInvite(createEvent())).rejects.toMatchObject({ statusCode: 403 });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["invite"] = "999";
        await expect(cancelTeamInvite(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns 404 for an unknown invitation when the caller is a member", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockParams.values["invite"] = "999";

        await expect(cancelTeamInvite(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("GET /api/team-invites", () => {
    it("returns only invitations addressed to the current email", async () => {
        const first = seedTeam(ctx, { name: "First team" });
        const second = seedTeam(ctx, { name: "Second team" });
        const user = seedUser(ctx, { email: "Invitee@basischina.com" });
        invite(first.id, "invitee@basischina.com");
        invite(second.id, "someone-else@basischina.com");
        mockSession.value = { user: { id: user.id } };

        await expect(listMyInvites(createEvent())).resolves.toEqual({
            invites: [{ id: 1, team_id: first.id, team_name: "First team" }],
        });
    });
});

describe("POST /api/team-invites/:id/accept", () => {
    it("joins the invited user and removes every invitation for that email", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const other = seedTeam(ctx, { name: "Other" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        invite(other.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).resolves.toEqual({
            message: "You joined Team",
        });
        const updated = ctx.drizzle.select().from(users).where(eq(users.id, user.id)).get();
        expect(updated!.team_id).toBe(team.id);
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(0);
    });

    it("does not reveal invitations addressed to another email", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "other@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects an invitation for a past season", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past", is_active: 0 });
        const pastTeam = seedTeam(ctx, { name: "Old", season_id: pastSeason.id });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(pastTeam.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects a team that already submitted", async () => {
        const team = seedTeam(ctx, { name: "Team", project_submitted: 1 });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects a user who is already in a team", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const current = seedTeam(ctx, { name: "Current" });
        const user = seedUser(ctx, { email: "newbie@basischina.com", team_id: current.id });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("lets a user with a past-season team join the active season", async () => {
        const pastSeason = seedSeason(ctx, { name: "Past membership", is_active: 0 });
        const pastTeam = seedTeam(ctx, { name: "Past team", season_id: pastSeason.id });
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com", team_id: pastTeam.id });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).resolves.toEqual({
            message: "You joined Team",
        });
        const updated = ctx.drizzle.select().from(users).where(eq(users.id, user.id)).get();
        expect(updated!.team_id).toBe(team.id);
    });

    it("returns 404 when the invited team no longer exists", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        ctx.sqlite.exec("PRAGMA foreign_keys = OFF");
        ctx.drizzle.delete(teams).where(eq(teams.id, team.id)).run();
        ctx.sqlite.exec("PRAGMA foreign_keys = ON");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects a full team", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        for (let index = 0; index < MAX_TEAM_MEMBERS; index++) {
            seedUser(ctx, { email: `member${index}@basischina.com`, team_id: team.id });
        }
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("refuses to join once the hackathon has finished", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "finished" });
        seedSeason(ctx);
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns 404 for an unknown invitation", async () => {
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = "999";

        await expect(acceptInvite(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("DELETE /api/team-invites/:id", () => {
    it("declines an invitation addressed to the current email", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "newbie@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(declineInvite(createEvent())).resolves.toEqual({
            message: "Invitation declined",
        });
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(0);
    });

    it("does not remove another email's invitation", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        const created = invite(team.id, "other@basischina.com");
        mockSession.value = { user: { id: user.id } };
        mockParams.values["id"] = String(created.id);

        await expect(declineInvite(createEvent())).rejects.toMatchObject({ statusCode: 404 });
        expect(ctx.drizzle.select().from(teamInvites).all()).toHaveLength(1);
    });
});

describe("team invite ownership", () => {
    it("never attaches a user without acceptance", async () => {
        const team = seedTeam(ctx, { name: "Team" });
        const owner = seedUser(ctx, { email: "owner@basischina.com", team_id: team.id });
        const user = seedUser(ctx, { email: "newbie@basischina.com" });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values["id"] = String(team.id);
        invite(team.id, "newbie@basischina.com");

        const persisted = ctx.drizzle.select().from(users).where(eq(users.id, user.id)).get();
        expect(persisted!.team_id).toBeNull();
        expect(ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()).toBeTruthy();
    });
});
