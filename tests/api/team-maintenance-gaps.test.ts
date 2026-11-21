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
import { eq } from "drizzle-orm";
import { hackathon, teamInvites, users } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
    VOTE_RATE_LIMIT_CONFIG: { maxRequests: 600, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let createTeamHandler: any;
let patchTeamHandler: any;
let deleteInviteHandler: any;
let listInvitesHandler: any;
let submitScoreHandler: any;
let addMemberHandler: any;
let removeMemberHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("updateTeamPartial", teamsDb.updateTeamPartial);
    vi.stubGlobal("createTeam", teamsDb.createTeam);
    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    createTeamHandler = (await import("~~/server/api/teams/index.post")).default;
    patchTeamHandler = (await import("~~/server/api/teams/[id]/index.patch")).default;
    deleteInviteHandler = (await import("~~/server/api/teams/[id]/invites/[invite].delete"))
        .default;
    listInvitesHandler = (await import("~~/server/api/teams/[id]/invites/index.get")).default;
    submitScoreHandler = (await import("~~/server/api/teams/[id]/scores/index.post")).default;
    addMemberHandler = (await import("~~/server/api/teams/[id]/users/index.post")).default;
    removeMemberHandler = (await import("~~/server/api/teams/[id]/users/[user]/index.delete"))
        .default;
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
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function setHackathon(overrides: Record<string, unknown>) {
    ctx.drizzle
        .update(hackathon)
        .set(overrides as any)
        .where(eq(hackathon.id, 1))
        .run();
}

describe("POST /api/teams closed-event messages", () => {
    it("reports the paused event", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        setHackathon({ status: "paused" });

        await expect(createTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("reports closed submissions", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        mockSession.value = { user: { id: user.id } };
        setHackathon({ status: "voting" });

        await expect(createTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot create team after submissions close",
        });
    });
});

describe("PATCH /api/teams/:id closed-event messages", () => {
    function seedOwnTeam() {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Own Team" });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, user.id)).run();
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: team.id };
        return { user, team };
    }

    it("reports the paused event", async () => {
        seedOwnTeam();
        setHackathon({ status: "paused" });

        await expect(patchTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("reports a finished hackathon", async () => {
        seedOwnTeam();
        setHackathon({ status: "finished" });

        await expect(patchTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot edit team and project after hackathon has finished",
        });
    });

    it("reports a hackathon in the voting phase", async () => {
        seedOwnTeam();
        setHackathon({ status: "voting" });

        await expect(patchTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot edit team and project after submissions close",
        });
    });

    it("rejects a pathway that is not part of the season rubric", async () => {
        seedOwnTeam();
        mockBody.value = { pathway: "unconfigured" };

        await expect(patchTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "Choose a track that is available for this season.",
        });
    });
});

describe("team invitation listing and cancellation without a team", () => {
    function seedInvite() {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Invite Team", owner_user_id: owner.id });
        const invite = ctx.drizzle
            .insert(teamInvites)
            .values({
                team_id: team.id,
                email: "guest@basischina.com",
                invited_by: owner.id,
                expires_at: new Date(Date.now() + 86_400_000),
            })
            .returning()
            .get();
        const outsider = seedUser(ctx, { email: "outsider@basischina.com" });
        mockSession.value = { user: { id: outsider.id } };
        return { team, invite, outsider };
    }

    it("rejects listing invitations for a user without a team", async () => {
        const { team } = seedInvite();
        mockParams.values = { id: team.id };

        await expect(listInvitesHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot view invitations for other teams",
        });
    });

    it("rejects cancelling an invitation for a user without a team", async () => {
        const { team, invite } = seedInvite();
        mockParams.values = { id: team.id, invite: invite.id };

        await expect(deleteInviteHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot cancel invitations for other teams",
        });
    });
});

describe("POST /api/teams/:id/scores assignment gate", () => {
    it("rejects a team outside the judge's assignment", async () => {
        setHackathon({ judging_open: 1 });
        const judge = seedUser(ctx, { email: "judge@basischina.com", role: "judge" });
        const other = seedUser(ctx, { email: "other-judge@basischina.com", role: "judge" });
        const team = seedTeam(ctx, {
            name: "Junior Team",
            pathway: "junior",
            project_submitted: 1,
        });
        const { judgeAssignments } = await import("~~/server/database/schema");
        ctx.drizzle
            .insert(judgeAssignments)
            .values({ season_id: 1, judge_user_id: other.id, pathway: "junior" })
            .run();
        ctx.drizzle
            .insert(judgeAssignments)
            .values({ season_id: 1, judge_user_id: judge.id, pathway: "senior" })
            .run();
        mockSession.value = { user: { id: judge.id } };
        mockParams.values = { id: team.id };

        await expect(submitScoreHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "This project is outside your judging assignment",
        });
    });
});

describe("POST /api/teams/:id/users closed-event messages", () => {
    function setupTeamAndOwner() {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Invite Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        seedUser(ctx, { email: "candidate@basischina.com" });
        mockSession.value = { user: { id: owner.id } };
        mockParams.values = { id: team.id };
        mockBody.value = { email: "candidate@basischina.com" };
        return { owner, team };
    }

    it("reports the paused event", async () => {
        setupTeamAndOwner();
        setHackathon({ status: "paused" });

        await expect(addMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("reports a finished hackathon", async () => {
        setupTeamAndOwner();
        setHackathon({ status: "voting" });

        await expect(addMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot invite members after the hackathon has finished",
        });
    });

    it("reports submissions closed outside the voting phase", async () => {
        setupTeamAndOwner();
        setHackathon({ status: "in_progress", end_timestamp: Date.now() - 60_000 });

        await expect(addMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot invite members after submissions close",
        });
    });

    it("falls back to a generic inviter name", async () => {
        const { team } = setupTeamAndOwner();
        const owner = ctx.drizzle
            .select()
            .from(users)
            .where(eq(users.id, mockSession.value!.user!.id))
            .get()!;
        ctx.drizzle.update(users).set({ name: null }).where(eq(users.id, owner.id)).run();

        const result = await addMemberHandler(createEvent());

        expect(result).toMatchObject({
            email: "candidate@basischina.com",
            message: "Invitation sent",
        });
        const notices = ctx.drizzle
            .select()
            .from((await import("~~/server/database/schema")).notifications)
            .all();
        expect(notices[0]!.body).toBe("A participant invited you to join Invite Team.");
        expect(team.id).toBe(1);
    });

    it("rejects a caller who is not in the invited team", async () => {
        const { team } = setupTeamAndOwner();
        const outsider = seedUser(ctx, { email: "outsider@basischina.com" });
        mockSession.value = { user: { id: outsider.id } };
        mockParams.values = { id: team.id };

        await expect(addMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members to other teams",
        });
    });

    it("rejects a teamless account that targets any team", async () => {
        const { team } = setupTeamAndOwner();
        const drifter = seedUser(ctx, { email: "drifter@basischina.com" });
        mockSession.value = { user: { id: drifter.id } };
        mockParams.values = { id: team.id };

        await expect(addMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members to other teams",
        });
    });
});

describe("DELETE /api/teams/:id/users/:user owner gate", () => {
    function seedRoster() {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const member = seedUser(ctx, { email: "member@basischina.com" });
        const team = seedTeam(ctx, { name: "Roster Team", owner_user_id: owner.id });
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, owner.id)).run();
        ctx.drizzle.update(users).set({ team_id: team.id }).where(eq(users.id, member.id)).run();
        return { owner, member, team };
    }

    it("rejects a non-owner member removing another member", async () => {
        const { member, team } = seedRoster();
        const target = seedUser(ctx, { email: "target@basischina.com", team_id: team.id });
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id, user: target.id };

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Only the team owner can remove other members",
        });
    });

    it("rejects a caller outside the team", async () => {
        const { team } = seedRoster();
        const outsider = seedUser(ctx, { email: "outsider@basischina.com" });
        mockSession.value = { user: { id: outsider.id } };
        mockParams.values = { id: team.id, user: outsider.id };

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members of other teams",
        });
    });

    it("rejects a teamless caller", async () => {
        const { team } = seedRoster();
        const drifter = seedUser(ctx, { email: "drifter@basischina.com" });
        mockSession.value = { user: { id: drifter.id } };
        mockParams.values = { id: team.id, user: drifter.id };

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members of other teams",
        });
    });

    it("reports a paused event", async () => {
        const { member, team } = seedRoster();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id, user: member.id };
        setHackathon({ status: "paused" });

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "The event is paused",
        });
    });

    it("reports a finished hackathon", async () => {
        const { member, team } = seedRoster();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id, user: member.id };
        setHackathon({ status: "finished" });

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after hackathon has finished",
        });
    });

    it("reports a hackathon in the voting phase", async () => {
        const { member, team } = seedRoster();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id, user: member.id };
        setHackathon({ status: "voting" });

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after hackathon has finished",
        });
    });

    it("reports closed submissions outside the voting phase", async () => {
        const { member, team } = seedRoster();
        mockSession.value = { user: { id: member.id } };
        mockParams.values = { id: team.id, user: member.id };
        setHackathon({ status: "in_progress", end_timestamp: Date.now() - 60_000 });

        await expect(removeMemberHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members after submissions close",
        });
    });
});
