import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
    createTestContext,
    mockBody,
    mockParams,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../api/helpers";
import { hackathon, notifications, teams } from "~~/server/database/schema";
import {
    requireUser as realRequireUser,
    optionalUser as realOptionalUser,
} from "~~/server/utils/auth";

let ctx: TestContext;
const handlers: Record<string, any> = {};

beforeAll(async () => {
    setupNitroGlobals();
    // Exercise the real authorization boundary instead of the permissive stub.
    vi.stubGlobal("requireUser", realRequireUser);
    vi.stubGlobal("optionalUser", realOptionalUser);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getTeamById", teamsDb.getTeamById);
    vi.stubGlobal("getSubmittedTeams", teamsDb.getSubmittedTeams);
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    vi.stubGlobal("getUserByEmail", usersDb.getUserByEmail);
    const peerDb = await import("~~/server/utils/database/peer-voting");
    vi.stubGlobal("getPeerVoteByUser", peerDb.getPeerVoteByUser);
    vi.stubGlobal("upsertPeerVote", peerDb.upsertPeerVote);
    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getScoreRankVisibilityResolver", seasonsDb.getScoreRankVisibilityResolver);
    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwards", awardsDb.getAwards);
    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    handlers.patchTeam = (await import("~~/server/api/teams/[id]/index.patch")).default;
    handlers.submitTeam = (await import("~~/server/api/teams/[id]/submit.post")).default;
    handlers.inviteMember = (await import("~~/server/api/teams/[id]/users/index.post")).default;
    handlers.removeMember = (
        await import("~~/server/api/teams/[id]/users/[user]/index.delete")
    ).default;
    handlers.roster = (await import("~~/server/api/teams/[id]/users/index.get")).default;
    handlers.teamDetail = (await import("~~/server/api/teams/[id]/index.get")).default;
    handlers.draft = (await import("~~/server/api/judging/drafts/[teamId].put")).default;
    handlers.finalize = (await import("~~/server/api/teams/[id]/scores/index.post")).default;
    handlers.voidScore = (
        await import("~~/server/api/admin/teams/[id]/scores/[judgeId].delete")
    ).default;
    handlers.reopen = (await import("~~/server/api/admin/teams/[id]/reopen.post")).default;
    handlers.teamStatus = (await import("~~/server/api/admin/teams/[id]/status.patch")).default;
    handlers.ballotGet = (await import("~~/server/api/ballot/index.get")).default;
    handlers.ballotPost = (await import("~~/server/api/ballot/index.post")).default;
    handlers.readNotification = (
        await import("~~/server/api/notifications/[id]/read.patch")
    ).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "in_progress", voting_enabled: 1 });
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

afterAll(() => {
    vi.unstubAllGlobals();
});

function participant(overrides: { team_id?: number | null; is_admin?: number; id?: number } = {}) {
    return seedUser(ctx, {
        email: `participant-${Math.random().toString(36).slice(2)}@example.test`,
        team_id: overrides.team_id ?? null,
        is_admin: overrides.is_admin ?? 0,
    });
}

/** An event whose identity is resolved by the real requireUser boundary. */
function eventFor(user: { id: number }, permissions: string[] = []) {
    return {
        context: {
            drizzle: ctx.drizzle,
            oauth2: {
                payload: { sub: `subject-${user.id}`, permissions },
                permissions,
                user,
            },
        },
    };
}

function anonymousEvent() {
    return { context: { drizzle: ctx.drizzle } };
}

describe("team authorization", () => {
    it("denies editing a team the caller does not belong to", async () => {
        const team = seedTeam(ctx, { name: "Target Team" });
        const user = participant();
        mockParams.values["id"] = String(team.id);
        mockBody.value = { name: "Hacked" };

        await expect(handlers.patchTeam(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot edit other teams",
        });
        expect(ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get()!.name).toBe(
            "Target Team",
        );
    });

    it("denies submitting another team's project", async () => {
        const team = seedTeam(ctx, { name: "Target Team" });
        const user = participant();
        mockParams.values["id"] = String(team.id);
        mockBody.value = {};

        await expect(handlers.submitTeam(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot submit other projects",
        });
    });

    it("denies inviting members to another team", async () => {
        const team = seedTeam(ctx, { name: "Target Team" });
        const user = participant();
        mockParams.values["id"] = String(team.id);
        mockBody.value = { email: "friend@example.test" };

        await expect(handlers.inviteMember(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members to other teams",
        });
    });

    it("denies removing members from another team", async () => {
        const team = seedTeam(ctx, { name: "Target Team" });
        const user = participant();
        mockParams.values["id"] = String(team.id);
        mockParams.values["user"] = "999";

        await expect(handlers.removeMember(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot remove members of other teams",
        });
    });

    it("denies a stale membership pointer access to an active team roster and invites", async () => {
        const archivedSeason = seedSeason(ctx, { name: "Archived", is_active: 0 });
        const archivedTeam = seedTeam(ctx, { name: "Old Team", season_id: archivedSeason.id });
        const activeTeam = seedTeam(ctx, { name: "Active Team" });
        const user = participant({ team_id: archivedTeam.id });

        mockParams.values["id"] = String(activeTeam.id);
        mockBody.value = { email: "friend@example.test" };
        await expect(handlers.inviteMember(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot add members to other teams",
        });

        mockParams.values["id"] = String(activeTeam.id);
        await expect(handlers.roster(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
        });
    });
});

describe("judging authorization", () => {
    it("denies saving a draft without the judging permission", async () => {
        const team = seedTeam(ctx, { project_submitted: 1 });
        const user = participant();
        mockParams.values["teamId"] = String(team.id);
        mockBody.value = { rubric_version_id: 1, scores: {}, reasoning: "" };

        await expect(handlers.draft(eventFor(user))).rejects.toMatchObject({ statusCode: 403 });
    });

    it("denies finalizing scores without the judging permission", async () => {
        const team = seedTeam(ctx, { project_submitted: 1 });
        const user = participant();
        mockParams.values["id"] = String(team.id);
        mockBody.value = { rubric_version_id: 1, scores: {}, reasoning: "" };

        await expect(handlers.finalize(eventFor(user))).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe("administrator authorization", () => {
    it.each([
        ["void a score", "voidScore", { id: "1", judgeId: "2" }],
        ["reopen a submission", "reopen", { id: "1" }],
        ["change a team status", "teamStatus", { id: "1" }],
    ])("denies a participant who tries to %s", async (_label, handlerName, params) => {
        const user = participant();
        Object.assign(mockParams.values, params);
        mockBody.value = { reason: "because" };

        await expect(handlers[handlerName](eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
        });
    });
});

describe("ballot eligibility", () => {
    it("denies reading the ballot without a team", async () => {
        const user = participant();

        await expect(handlers.ballotGet(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Only participants can vote",
        });
    });

    it("denies submitting a ballot without a team", async () => {
        const user = participant();
        mockBody.value = { scores: [], reasoning: "" };

        await expect(handlers.ballotPost(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Only participants can vote",
        });
    });

    it("denies a team that has not submitted a project", async () => {
        const team = seedTeam(ctx, { project_submitted: 0 });
        const user = participant({ team_id: team.id });

        await expect(handlers.ballotGet(eventFor(user))).rejects.toMatchObject({
            statusCode: 403,
            message: "Only participants with submitted projects can vote",
        });
    });
});

describe("public gallery gates", () => {
    it("hides an unsubmitted active-season project from anonymous callers", async () => {
        const team = seedTeam(ctx, { name: "Draft Team", project_submitted: 0 });
        mockParams.values["id"] = String(team.id);

        await expect(handlers.teamDetail(anonymousEvent())).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("hides an active-season project before submissions close", async () => {
        const team = seedTeam(ctx, { name: "Submitted Team", project_submitted: 1 });
        mockParams.values["id"] = String(team.id);

        await expect(handlers.teamDetail(anonymousEvent())).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("exposes a submitted project after the gallery opens", async () => {
        ctx.drizzle.update(hackathon).set({ status: "voting" }).run();
        const team = seedTeam(ctx, { name: "Submitted Team", project_submitted: 1 });
        mockParams.values["id"] = String(team.id);

        const result = await handlers.teamDetail(anonymousEvent());

        expect(result).toMatchObject({ id: team.id, name: "Submitted Team" });
    });
});

describe("notification ownership", () => {
    it("does not let a user read another user's notification", async () => {
        const owner = participant();
        const attacker = participant();
        const notification = ctx.drizzle
            .insert(notifications)
            .values({ user_id: owner.id, type: "team_invite", title: "Private" })
            .returning()
            .get();

        mockParams.values["id"] = String(notification.id);

        await expect(handlers.readNotification(eventFor(attacker))).rejects.toMatchObject({
            statusCode: 404,
        });
        expect(
            ctx.drizzle
                .select()
                .from(notifications)
                .where(eq(notifications.id, notification.id))
                .get()!.read_at,
        ).toBeNull();
    });
});
