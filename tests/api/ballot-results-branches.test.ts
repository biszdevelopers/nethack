import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockQueryState,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { peerVotingScores } from "~~/server/database/schema";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let resultsHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    resultsHandler = (await import("~~/server/api/ballot/results.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function seedVoting(
    seasonOverrides: Record<string, unknown> = {},
    hackathonOverrides: Record<string, unknown> = {},
) {
    seedHackathon(ctx, {
        status: "voting",
        voting_enabled: 0,
        results_published: 1,
        ...hackathonOverrides,
    });
    return seedSeason(ctx, { results_published: 1, ...seasonOverrides });
}

describe("GET /api/ballot/results", () => {
    it("returns 404 when People's Choice reporting is disabled", async () => {
        vi.stubEnv("PEOPLES_CHOICE_ENABLED", "0");
        seedHackathon(ctx);
        mockQueryState.value = {};

        try {
            await expect(resultsHandler(createEvent())).rejects.toMatchObject({
                statusCode: 404,
                message: "Peer-voting results are disabled",
            });
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("returns 404 when no season exists", async () => {
        seedHackathon(ctx);
        mockQueryState.value = {};

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 for a season selected by id that does not exist", async () => {
        seedVoting();
        mockQueryState.value = { season_id: 999 };

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses to reveal results while peer voting is still open", async () => {
        seedHackathon(ctx, { status: "voting", voting_enabled: 1, results_published: 1 });
        seedSeason(ctx, { results_published: 1 });
        mockQueryState.value = {};

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({
            statusCode: 409,
            message: "Peer voting is still open",
        });
    });

    it("hides results until submissions close", async () => {
        seedHackathon(ctx, { status: "in_progress", voting_enabled: 0, results_published: 1 });
        seedSeason(ctx, { results_published: 1 });
        mockQueryState.value = {};

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are available after submissions close",
        });
    });

    it("hides unpublished results from participants", async () => {
        seedHackathon(ctx, { status: "voting", voting_enabled: 0, results_published: 0 });
        seedSeason(ctx, { results_published: 0 });
        mockQueryState.value = {};

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are not published yet",
        });
    });

    it("lets judging staff read unpublished results", async () => {
        seedHackathon(ctx, { status: "voting", voting_enabled: 0, results_published: 0 });
        const season = seedSeason(ctx, { results_published: 0 });
        seedTeam(ctx, {
            name: "Project One",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        mockQueryState.value = {};

        const result = await resultsHandler(
            createEvent({
                context: {
                    drizzle: ctx.drizzle,
                    oauth2: { permissions: ["nethack.Judging.assignmentsRead"] },
                },
            }),
        );

        expect(result.season_id).toBe(season.id);
        expect(result.results_visible).toBe(false);
        expect(result.voting_closed).toBe(true);
    });

    it("summarizes turnout and per-project team units for a published season", async () => {
        const season = seedHackathonAndSeasonWithTeam();
        const voterTeam = seedTeam(ctx, {
            name: "Voting Team",
            project_submitted: 0,
            season_id: season.id,
        });
        const voterOne = seedUser(ctx, { email: "v1@basischina.com", team_id: voterTeam.id });
        const voterTwo = seedUser(ctx, { email: "v2@basischina.com", team_id: voterTeam.id });
        ctx.drizzle
            .insert(peerVotingScores)
            .values([
                {
                    user_id: voterOne.id,
                    season_id: season.id,
                    team_id: voterTeam.id,
                    score: JSON.stringify({ [season.teamId]: 5 }),
                },
                {
                    user_id: voterTwo.id,
                    season_id: season.id,
                    team_id: voterTeam.id,
                    score: JSON.stringify({ [season.teamId]: 3 }),
                },
            ])
            .run();
        mockQueryState.value = {};

        const result = await resultsHandler(createEvent());

        expect(result).toMatchObject({
            season_id: season.id,
            results_visible: true,
            voting_closed: true,
            turnout: {
                submitted_teams: 1,
                voting_teams: 1,
                ballots: 2,
                turnout_ratio: 1,
            },
        });
        expect(result.projects).toEqual([
            {
                team_id: season.teamId,
                name: "Project One",
                pathway: "junior",
                average_stars: 4,
                team_units: 1,
            },
        ]);
    });

    it("skips ballots without recorded team provenance", async () => {
        const season = seedHackathonAndSeasonWithTeam();
        const voterTeam = seedTeam(ctx, {
            name: "Voting Team",
            project_submitted: 0,
            season_id: season.id,
        });
        const provenanced = seedUser(ctx, {
            email: "provenanced@basischina.com",
            team_id: voterTeam.id,
        });
        const legacy = seedUser(ctx, {
            email: "legacy@basischina.com",
            team_id: voterTeam.id,
        });
        ctx.drizzle
            .insert(peerVotingScores)
            .values([
                {
                    user_id: provenanced.id,
                    season_id: season.id,
                    team_id: voterTeam.id,
                    score: JSON.stringify({ [season.teamId]: 4 }),
                },
                {
                    user_id: legacy.id,
                    season_id: season.id,
                    score: JSON.stringify({ [season.teamId]: 5 }),
                },
            ])
            .run();
        mockQueryState.value = {};

        const result = await resultsHandler(createEvent());

        expect(result.turnout).toMatchObject({ voting_teams: 1, ballots: 2 });
        expect(result.projects[0]!.average_stars).toBe(4);
    });

    it("excludes ballots from a withdrawn voting team", async () => {
        const season = seedHackathonAndSeasonWithTeam();
        const activeVoterTeam = seedTeam(ctx, {
            name: "Active Voter",
            project_submitted: 0,
            season_id: season.id,
        });
        const withdrawnVoterTeam = seedTeam(ctx, {
            name: "Withdrawn Voter",
            project_submitted: 0,
            season_id: season.id,
            status: "withdrawn",
        });
        const activeVoter = seedUser(ctx, {
            email: "active-voter@basischina.com",
            team_id: activeVoterTeam.id,
        });
        const withdrawnVoter = seedUser(ctx, {
            email: "withdrawn-voter@basischina.com",
            team_id: withdrawnVoterTeam.id,
        });
        ctx.drizzle
            .insert(peerVotingScores)
            .values([
                {
                    user_id: activeVoter.id,
                    season_id: season.id,
                    team_id: activeVoterTeam.id,
                    score: JSON.stringify({ [season.teamId]: 4 }),
                },
                {
                    user_id: withdrawnVoter.id,
                    season_id: season.id,
                    team_id: withdrawnVoterTeam.id,
                    score: JSON.stringify({ [season.teamId]: 2 }),
                },
            ])
            .run();
        mockQueryState.value = {};

        const result = await resultsHandler(createEvent());

        expect(result.turnout).toMatchObject({ voting_teams: 1, ballots: 1 });
        expect(result.projects[0]!.average_stars).toBe(4);
    });

    it("reports zero turnout when no project was submitted", async () => {
        seedVoting();
        mockQueryState.value = {};

        const result = await resultsHandler(createEvent());

        expect(result.turnout).toEqual({
            submitted_teams: 0,
            voting_teams: 0,
            ballots: 0,
            turnout_ratio: 0,
        });
        expect(result.projects).toEqual([]);
    });

    it("reads a past season's published results", async () => {
        const past = seedVoting({ is_active: 0 });
        mockQueryState.value = { season_id: past.id };

        const result = await resultsHandler(createEvent());

        expect(result.season_id).toBe(past.id);
        expect(result.results_visible).toBe(true);
    });

    it("reads past results while the active event is still voting", async () => {
        seedHackathon(ctx, { status: "voting", voting_enabled: 1, results_published: 1 });
        seedSeason(ctx, { results_published: 1 });
        const past = seedSeason(ctx, {
            name: "Past season",
            is_active: 0,
            results_published: 1,
        });
        mockQueryState.value = { season_id: past.id };

        const result = await resultsHandler(createEvent());

        expect(result.season_id).toBe(past.id);
        expect(result.voting_closed).toBe(true);
        expect(result.results_visible).toBe(true);
    });

    it("keeps an unpublished past season hidden while the active event is voting", async () => {
        seedHackathon(ctx, { status: "voting", voting_enabled: 1, results_published: 1 });
        seedSeason(ctx, { results_published: 1 });
        const past = seedSeason(ctx, {
            name: "Unpublished past season",
            is_active: 0,
            results_published: 0,
        });
        mockQueryState.value = { season_id: past.id };

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Peer-voting results are not published yet",
        });
    });

    it("keeps a paused event's results hidden from participants", async () => {
        seedHackathon(ctx, { status: "paused", voting_enabled: 0, results_published: 1 });
        seedSeason(ctx, { results_published: 1 });
        mockQueryState.value = {};

        await expect(resultsHandler(createEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    function seedHackathonAndSeasonWithTeam() {
        seedHackathon(ctx, { status: "voting", voting_enabled: 0, results_published: 1 });
        const season = seedSeason(ctx, { results_published: 1 });
        const team = seedTeam(ctx, {
            name: "Project One",
            pathway: "junior",
            season_id: season.id,
            project_submitted: 1,
        });
        return Object.assign(season, { teamId: team.id });
    }
});
