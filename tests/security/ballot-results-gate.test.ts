import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
    createTestContext,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "../api/helpers";
import { hackathon, peerVotingScores, seasons } from "~~/server/database/schema";
import { NethackPermissions } from "~~/shared/permissions";

let ctx: TestContext;
let handler: any;
let permissions: string[] | undefined;

beforeAll(async () => {
    setupNitroGlobals();
    handler = (await import("~~/server/api/ballot/results.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx, { status: "voting", voting_enabled: 1 });
    seedSeason(ctx);
    permissions = undefined;
});

afterEach(() => {
    resetTestContext(ctx);
});

function event() {
    return {
        context: {
            drizzle: ctx.drizzle,
            ...(permissions ? { oauth2: { payload: { sub: "subject" }, permissions } } : {}),
        },
    };
}

function vote(teamId: number, evaluatorEmail: string, scores: Record<string, number>) {
    const evaluator = seedUser(ctx, { email: evaluatorEmail, team_id: teamId });
    ctx.drizzle
        .insert(peerVotingScores)
        .values({
            user_id: evaluator.id,
            season_id: ctx.drizzle.select().from(seasons).where(eq(seasons.is_active, 1)).get()!.id,
            score: JSON.stringify(scores),
            reasoning: "peer ballot",
        })
        .run();
}

function publishResults() {
    ctx.drizzle.update(hackathon).set({ results_published: 1 }).run();
    ctx.drizzle.update(seasons).set({ results_published: 1 }).run();
}

describe("GET /api/ballot/results access gate", () => {
    it("refuses every caller while peer voting is open", async () => {
        await expect(handler(event())).rejects.toMatchObject({ statusCode: 409 });
    });

    it("refuses anonymous callers before results are published", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are not published yet",
        });
    });

    it("refuses participants with a team before results are published", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();
        const team = seedTeam(ctx, { project_submitted: 1 });
        const member = seedUser(ctx, { email: "member@example.test", team_id: team.id });

        vi.mocked(globalThis.optionalUser as any).mockResolvedValueOnce(member);
        permissions = [];

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are not published yet",
        });
    });

    it("refuses teamless participants before results are published", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();
        const member = seedUser(ctx, { email: "teamless@example.test" });

        vi.mocked(globalThis.optionalUser as any).mockResolvedValueOnce(member);
        permissions = [];

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are not published yet",
        });
    });

    it("refuses published results while the gallery is still private", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0, status: "in_progress" }).run();
        publishResults();

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are available after submissions close",
        });
    });

    it("lets privileged viewers read unpublished aggregate results", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();
        const project = seedTeam(ctx, { name: "Project", project_submitted: 1, pathway: "junior" });
        const voterTeam = seedTeam(ctx, { name: "Voter", project_submitted: 0 });
        vote(voterTeam.id, "voter@example.test", { [project.id]: 7 });
        const judge = seedUser(ctx, { email: "judge@example.test" });
        vi.mocked(globalThis.optionalUser as any).mockResolvedValueOnce(judge);
        permissions = [NethackPermissions.Judging.assignmentsRead];

        const result = await handler(event());

        expect(result.results_visible).toBe(false);
        expect(result.projects).toEqual([
            {
                team_id: project.id,
                name: "Project",
                pathway: "junior",
                average_stars: 7,
                team_units: 1,
            },
        ]);
    });

    it("exposes only aggregate fields, never individual ballots", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();
        const project = seedTeam(ctx, { name: "Project", project_submitted: 1, pathway: "junior" });
        const voterTeam = seedTeam(ctx, { name: "Voter", project_submitted: 0 });
        vote(voterTeam.id, "voter@example.test", { [project.id]: 5 });
        const judge = seedUser(ctx, { email: "judge@example.test" });
        vi.mocked(globalThis.optionalUser as any).mockResolvedValueOnce(judge);
        permissions = [NethackPermissions.Judging.assignmentsRead];

        const result = await handler(event());
        const serialized = JSON.stringify(result);

        expect(result.projects[0]).toEqual({
            team_id: project.id,
            name: "Project",
            pathway: "junior",
            average_stars: 5,
            team_units: 1,
        });
        expect(result.turnout).toEqual({
            submitted_teams: 1,
            voting_teams: 1,
            ballots: 1,
            turnout_ratio: 1,
        });
        expect(serialized).not.toMatch(/user_id|reasoning|score"|voter@example/i);
    });

    it("lets anonymous callers read published results", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0 }).run();
        publishResults();
        seedTeam(ctx, { name: "Project", project_submitted: 1 });

        const result = await handler(event());

        expect(result.results_visible).toBe(true);
        expect(result.projects).toHaveLength(1);
    });

    it("refuses anonymous callers when the event is paused even after publication", async () => {
        ctx.drizzle.update(hackathon).set({ voting_enabled: 0, status: "paused" }).run();
        publishResults();

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 403 });
    });
});
