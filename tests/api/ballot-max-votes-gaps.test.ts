import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockSession,
    resetMockState,
    resetTestContext,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";

const mocks = vi.hoisted(() => ({
    getEventState: vi.fn(),
}));

vi.mock("~~/server/utils/event-state", () => ({
    getEventState: mocks.getEventState,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
    VOTE_RATE_LIMIT_CONFIG: { maxRequests: 600, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let ballotHandler: any;
let submitHandler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getSubmittedTeams", teamsDb.getSubmittedTeams);
    const peerDb = await import("~~/server/utils/database/peer-voting");
    vi.stubGlobal("getPeerVoteByUser", peerDb.getPeerVoteByUser);
    vi.stubGlobal("upsertPeerVote", peerDb.upsertPeerVote);
    const { convertTeamToPublic } = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convertTeamToPublic);

    ballotHandler = (await import("~~/server/api/ballot/index.get")).default;
    submitHandler = (await import("~~/server/api/ballot/index.post")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedSeason(ctx);
    const team = seedTeam(ctx, { name: "Voter Team", project_submitted: 1, pathway: "junior" });
    const user = seedUser(ctx, { email: "voter@basischina.com", team_id: team.id });
    mockSession.value = { user: { id: user.id } };
    mocks.getEventState.mockReset();
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return { context: { drizzle: ctx.drizzle } };
}

describe("ballot max-vote fallback when the live hackathon row is partial", () => {
    it("reads zero for GET when the setting is missing", async () => {
        mocks.getEventState.mockResolvedValue({
            votingOpen: true,
            hackathon: { status: "voting", voting_enabled: 1 },
        });

        const result = await ballotHandler(createEvent());

        expect(result).toMatchObject({ submitted: false, scores: [], max_votes_per_user: 0 });
    });

    it("reads zero for POST when the setting is missing", async () => {
        mocks.getEventState.mockResolvedValue({
            votingOpen: true,
            hackathon: { status: "voting", voting_enabled: 1 },
        });
        seedTeam(ctx, { name: "Peer A", project_submitted: 1, pathway: "junior" });
        seedTeam(ctx, { name: "Peer B", project_submitted: 1, pathway: "junior" });
        mockBody.value = { scores: [5, 5], reasoning: "" };

        await expect(submitHandler(createEvent())).resolves.toEqual({
            message: "Successfully submitted vote!",
        });
    });
});
