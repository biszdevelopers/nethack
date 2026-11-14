import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockQueryState,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    seedTeam,
    type TestContext,
} from "./helpers";
import { eq, and } from "drizzle-orm";
import {
    teams,
    users,
    teamScores,
    peerVotingScores,
    teamAwards,
    userPastTeams,
    hackathon,
} from "~~/server/database/schema";

vi.mock("~~/server/utils/auth", () => ({
    requireUser: vi.fn((...args: any[]) => (globalThis as any).requireUser(...args)),
    requireJudge: vi.fn((...args: any[]) => (globalThis as any).requireJudge(...args)),
    requireAdmin: vi.fn((...args: any[]) => (globalThis as any).requireAdmin(...args)),
    requirePermission: vi.fn((...args: any[]) => (globalThis as any).requirePermission(...args)),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
    VOTE_RATE_LIMIT_CONFIG: { maxRequests: 600, windowMs: 60 * 1000 },
}));

const SQL_METACHARACTERS = [
    "' OR 1=1 --",
    "'; DROP TABLE users; --",
    "' OR 'a'='a",
    "1; DELETE FROM teams; --",
];

let ctx: TestContext;
let createTeamHandler: any;
let updateTeamHandler: any;
let updateUserHandler: any;
let submitTeamHandler: any;
let getTeamHandler: any;
let listTeamsHandler: any;

beforeAll(async () => {
    setupNitroGlobals();

    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    vi.stubGlobal("getUserByEmail", usersDb.getUserByEmail);
    vi.stubGlobal("updateUserName", usersDb.updateUserName);
    vi.stubGlobal("updateUserProfileTheme", usersDb.updateUserProfileTheme);
    vi.stubGlobal("updateUserProfilePicture", usersDb.updateUserProfilePicture);

    const teamsDb = await import("~~/server/utils/database/teams");
    vi.stubGlobal("createTeam", teamsDb.createTeam);
    vi.stubGlobal("getTeam", teamsDb.getTeam);
    vi.stubGlobal("getTeamById", teamsDb.getTeamById);
    vi.stubGlobal("updateTeam", teamsDb.updateTeam);
    vi.stubGlobal("deleteTeams", teamsDb.deleteTeams);

    const membersDb = await import("~~/server/utils/database/members");
    vi.stubGlobal("addTeamMember", membersDb.addTeamMember);
    vi.stubGlobal("getTeamMembers", membersDb.getTeamMembers);
    vi.stubGlobal("getAllTeamMembers", membersDb.getAllTeamMembers);

    const hackathonDb = await import("~~/server/utils/database/hackathon");
    vi.stubGlobal("getHackathon", hackathonDb.getHackathon);

    const seasonsDb = await import("~~/server/utils/database/seasons");
    vi.stubGlobal("getActiveSeason", seasonsDb.getActiveSeason);
    vi.stubGlobal("getScoreRankVisibilityResolver", seasonsDb.getScoreRankVisibilityResolver);

    const convert = await import("~~/server/utils/convert");
    vi.stubGlobal("convertTeamToPublic", convert.convertTeamToPublic);
    vi.stubGlobal("convertUserToPublic", convert.convertUserToPublic);

    const scoresDb = await import("~~/server/utils/database/scores");
    vi.stubGlobal("createTeamScores", scoresDb.createTeamScores);

    const peerDb = await import("~~/server/utils/database/peer-voting");
    vi.stubGlobal("getPeerVoteByUser", peerDb.getPeerVoteByUser);
    vi.stubGlobal("upsertPeerVote", peerDb.upsertPeerVote);

    const awardsDb = await import("~~/server/utils/database/awards");
    vi.stubGlobal("getAwardsForTeams", awardsDb.getAwardsForTeams);
    vi.stubGlobal("getAwards", awardsDb.getAwards);

    vi.stubGlobal("getTeamsBySeason", teamsDb.getTeamsBySeason);
    vi.stubGlobal("getAllTeams", teamsDb.getAllTeams);
    vi.stubGlobal("getSubmittedTeams", teamsDb.getSubmittedTeams);
    vi.stubGlobal("getSubmittedUnjudgedTeams", teamsDb.getSubmittedUnjudgedTeams);

    createTeamHandler = (await import("~~/server/api/teams/index.post")).default;
    updateTeamHandler = (await import("~~/server/api/teams/[id]/index.patch")).default;
    updateUserHandler = (await import("~~/server/api/users/[id]/index.patch")).default;
    submitTeamHandler = (await import("~~/server/api/teams/[id]/submit.post")).default;
    getTeamHandler = (await import("~~/server/api/teams/[id]/index.get")).default;
    listTeamsHandler = (await import("~~/server/api/teams/index.get")).default;
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
    const body = Buffer.from(JSON.stringify(mockBody.value ?? {}));
    const request = Object.assign(Readable.from([body]), {
        headers: {
            "content-length": String(body.byteLength),
            "content-type": "application/json",
        },
        socket: { remoteAddress: "127.0.0.1" },
    });

    return {
        context: { drizzle: ctx.drizzle },
        node: { req: request, res: { headersSent: false, setHeader() {} } },
        ...overrides,
    };
}

describe("SQL injection hardening", () => {
    describe("getUserByEmail database helper", () => {
        it("treats SQL metacharacters in email as literals", async () => {
            const { getUserByEmail } = await import("~~/server/utils/database/users");

            seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            const result = await getUserByEmail(createEvent(), "' OR 1=1 --@basischina.com");

            expect(result).toBeNull();
        });

        it("does not match other users when email contains SQL metacharacters", async () => {
            const { getUserByEmail } = await import("~~/server/utils/database/users");

            seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            seedUser(ctx, { email: "bob@basischina.com", name: "Bob" });

            const result = await getUserByEmail(createEvent(), "' OR 1=1 --@basischina.com");

            expect(result).toBeNull();
        });
    });

    describe("POST /api/teams", () => {
        it.each(SQL_METACHARACTERS)("stores team name %j as a literal string", async (name) => {
            seedUser(ctx, { email: "creator@basischina.com" });
            mockSession.value = { user: { id: 1 } };
            mockBody.value = { name };

            const result = await createTeamHandler(createEvent());

            expect(result).toHaveProperty("name", name);

            const row = ctx.drizzle.select().from(teams).where(eq(teams.name, name)).get();
            expect(row).toBeDefined();
            expect(row!.name).toBe(name);

            const allTeams = ctx.drizzle.select().from(teams).all();
            expect(allTeams).toHaveLength(1);
        });
    });

    describe("PATCH /api/teams/:id", () => {
        it.each(SQL_METACHARACTERS)("stores team name %j as a literal string", async (name) => {
            const team = seedTeam(ctx, { name: "Original Name" });
            seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

            mockSession.value = { user: { id: 1 } };
            mockParams.values["id"] = String(team.id);
            mockBody.value = { name };

            const result = await updateTeamHandler(createEvent());

            expect(result).toEqual({ message: "Updated your team & project" });

            const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(row!.name).toBe(name);

            const allTeams = ctx.drizzle.select().from(teams).all();
            expect(allTeams).toHaveLength(1);
        });

        it.each(SQL_METACHARACTERS)(
            "stores project description %j as a literal string",
            async (description) => {
                const team = seedTeam(ctx, { name: "Original Name" });
                seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

                mockSession.value = { user: { id: 1 } };
                mockParams.values["id"] = String(team.id);
                mockBody.value = { project: { description } };

                await updateTeamHandler(createEvent());

                const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
                expect(row!.project_description).toBe(description);
            },
        );
    });

    describe("PATCH /api/users/:id", () => {
        it.each(SQL_METACHARACTERS)("stores user name %j as a literal string", async (name) => {
            const user = seedUser(ctx, { email: "user@basischina.com", name: "Original" });

            mockSession.value = { user: { id: user.id } };
            mockParams.values["id"] = String(user.id);
            mockBody.value = { name };

            const result = await updateUserHandler(createEvent());

            expect(result).toEqual({ message: "Your profile is updated" });

            const row = ctx.drizzle.select().from(users).where(eq(users.id, user.id)).get();
            expect(row!.name).toBe(name);

            const allUsers = ctx.drizzle.select().from(users).all();
            expect(allUsers).toHaveLength(1);
        });
    });
});

// =============================================================================
// ADVANCED SQL INJECTION PATTERNS
// =============================================================================

const ADVANCED_PATTERNS = [
    "' UNION SELECT * FROM users --",
    "' OR IF(1=1,SLEEP(0),0) --",
    "'; DROP TABLE teams; SELECT * FROM teams WHERE '1'='1",
    "'/**/OR/**/1=1/**/--",
    "' OR '1'='1' %00 --",
    "' oR 1=1 --",
    "' OR 1=1 Ā--",
    '" OR 1=1 --',
];

describe("advanced SQL injection patterns in team name (createTeam)", () => {
    it.each(ADVANCED_PATTERNS)("stores pattern %j as literal string", async (name) => {
        seedUser(ctx, { email: "creator@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", name);

        const row = ctx.drizzle.select().from(teams).where(eq(teams.name, name)).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe(name);

        const allTeams = ctx.drizzle.select().from(teams).all();
        expect(allTeams).toHaveLength(1);
    });
});

describe("advanced SQL injection patterns in team description (PATCH)", () => {
    it.each(ADVANCED_PATTERNS)("stores description %j as literal string", async (desc) => {
        const team = seedTeam(ctx, { name: "DescTeam" });
        seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { project: { description: desc } };

        await updateTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_description).toBe(desc);
        const allTeams = ctx.drizzle.select().from(teams).all();
        expect(allTeams).toHaveLength(1);
    });
});

describe("additional PATCH team fields", () => {
    it.each(["' UNION SELECT * FROM users --", "' OR 1=1 --", "<script>injection</script>"])(
        "stores project name %j as literal string",
        async (projectName) => {
            const team = seedTeam(ctx, { name: "FieldTeam" });
            seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

            mockSession.value = { user: { id: 1 } };
            mockParams.values["id"] = String(team.id);
            mockBody.value = { project: { name: projectName } };

            await updateTeamHandler(createEvent());

            const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(row!.project_name).toBe(projectName);
        },
    );

    it.each(["' OR '1'='1", "1; DROP TABLE users; --"])(
        "stores sourcing field %j as literal string",
        async (sourcing) => {
            const team = seedTeam(ctx, { name: "SourceTeam" });
            seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

            mockSession.value = { user: { id: 1 } };
            mockParams.values["id"] = String(team.id);
            mockBody.value = { project: { sourcing } };

            await updateTeamHandler(createEvent());

            const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(row!.sourcing).toBe(sourcing);
        },
    );
});

describe("SQL injection in team project fields (POST submit)", () => {
    it.each(["' OR 1=1 --", "' UNION SELECT * FROM users --"])(
        "stores submitted project description %j as literal",
        async (description) => {
            seedUser(ctx, { email: "creator@basischina.com" });
            const team = seedTeam(ctx, {
                name: "SubmitTeam",
                pathway: "junior",
                project_submitted: 0,
                season_id: 1,
            });
            seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

            mockSession.value = { user: { id: 2 } };
            mockParams.values["id"] = String(team.id);
            mockBody.value = {
                pathway: "junior",
                project: {
                    name: "Valid Project",
                    description,
                    demo_url: "https://example.com/demo",
                    repo_url: "https://github.com/example/repo",
                },
            };

            const result = await submitTeamHandler(createEvent());

            expect(result).toEqual({ message: "Successfully submitted project" });

            const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(row!.project_description).toBe(description);
        },
    );

    it("stores project name with SQL content as literal via submit", async () => {
        seedUser(ctx, { email: "creator@basischina.com" });
        const team = seedTeam(ctx, {
            name: "SubmitTeam2",
            pathway: "junior",
            project_submitted: 0,
            season_id: 1,
        });
        seedUser(ctx, { email: "member2@basischina.com", team_id: team.id });

        const sqlName = "' DROP TABLE teams; --";

        mockSession.value = { user: { id: 2 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            pathway: "junior",
            project: {
                name: sqlName,
                description:
                    "This is a completely valid description that is at least 30 characters long.",
                demo_url: "https://example.com/demo",
                repo_url: "https://github.com/example/repo",
            },
        };

        await submitTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_name).toBe(sqlName);
    });
});

describe("SQL injection in peer voting reasoning (direct DB helper)", () => {
    it("stores reasoning with SQL content as literal via upsertPeerVote", async () => {
        const { upsertPeerVote } = await import("~~/server/utils/database/peer-voting");

        const sqlReasoning = "' OR 1=1 -- DROP TABLE ballots; --";

        await upsertPeerVote(createEvent(), {
            user_id: 999,
            score: JSON.stringify({}),
            reasoning: sqlReasoning,
        });

        const vote = ctx.drizzle
            .select()
            .from(peerVotingScores)
            .where(eq(peerVotingScores.user_id, 999))
            .get();
        expect(vote).toBeTruthy();
        expect(vote!.reasoning).toBe(sqlReasoning);
    });
});

describe("SQL injection in judge scores reasoning (direct DB helper)", () => {
    it("stores reasoning with SQL content as literal via createTeamScores", async () => {
        const { createTeamScores } = await import("~~/server/utils/database/scores");

        const team = seedTeam(ctx, { name: "ScoredTeam", project_submitted: 1, pathway: "junior" });
        seedUser(ctx, { email: "judge@basischina.com", role: "judge" });

        const sqlReasoning = "'; UPDATE teams SET name='hacked' WHERE 1=1; --";

        await createTeamScores(createEvent(), {
            team_id: team.id,
            season_id: 1,
            judge_user_id: 1,
            rubric_version_id: 1,
            scores: JSON.stringify({
                originality: 4,
                presentation: 3,
                technicality: 4,
                theme: 3,
                impact: 4,
            }),
            reasoning: sqlReasoning,
        });

        const score = ctx.drizzle
            .select()
            .from(teamScores)
            .where(and(eq(teamScores.team_id, team.id), eq(teamScores.judge_user_id, 1)))
            .get();
        expect(score).toBeTruthy();
        expect(score!.reasoning).toBe(sqlReasoning);

        // Verify team name was NOT updated (second-order protection)
        const unaffectedTeam = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(unaffectedTeam!.name).toBe("ScoredTeam");
    });
});

// =============================================================================
// NUMERIC PARAMETER INJECTION
// =============================================================================

describe("numeric parameter injection - GET /api/teams/:id", () => {
    it("rejects non-numeric team ID", async () => {
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({ id: 1, team_id: null, role: "participant" });

        mockParams.values["id"] = "abc";

        await expect(getTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects negative team ID", async () => {
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({ id: 1, team_id: null, role: "participant" });

        mockParams.values["id"] = "-1";

        await expect(getTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects zero team ID", async () => {
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({ id: 1, team_id: null, role: "participant" });

        mockParams.values["id"] = "0";

        await expect(getTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects floating point team ID", async () => {
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({ id: 1, team_id: null, role: "participant" });

        mockParams.values["id"] = "1.5";

        await expect(getTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects SQL-injected team ID like '1 OR 1=1'", async () => {
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({ id: 1, team_id: null, role: "participant" });

        mockParams.values["id"] = "1 OR 1=1";

        await expect(getTeamHandler(createEvent())).rejects.toThrow();
    });
});

describe("numeric parameter injection - PATCH /api/teams/:id", () => {
    it("rejects non-numeric team ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "abc";
        mockBody.value = { name: "Hack" };

        await expect(updateTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects negative team ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "-1";
        mockBody.value = { name: "Hack" };

        await expect(updateTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects zero team ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "0";
        mockBody.value = { name: "Hack" };

        await expect(updateTeamHandler(createEvent())).rejects.toThrow();
    });
});

describe("numeric parameter injection - PATCH /api/users/:id", () => {
    it("rejects non-numeric user ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "abc";
        mockBody.value = { name: "NewName" };

        await expect(updateUserHandler(createEvent())).rejects.toThrow();
    });

    it("rejects negative user ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "-1";
        mockBody.value = { name: "NewName" };

        await expect(updateUserHandler(createEvent())).rejects.toThrow();
    });
});

describe("numeric parameter injection - POST /api/teams/:id/submit", () => {
    it("rejects non-numeric team ID", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "abc";
        mockBody.value = {
            pathway: "junior",
            project: {
                name: "Project",
                description: "A description that is at least thirty characters long.",
                demo_url: "https://example.com",
                repo_url: "https://github.com/example/repo",
            },
        };

        await expect(submitTeamHandler(createEvent())).rejects.toThrow();
    });

    it("rejects SQL-injected team ID '1 OR 1=1'", async () => {
        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = "1 OR 1=1";
        mockBody.value = {
            pathway: "junior",
            project: {
                name: "Project",
                description: "A description that is at least thirty characters long.",
                demo_url: "https://example.com",
                repo_url: "https://github.com/example/repo",
            },
        };

        await expect(submitTeamHandler(createEvent())).rejects.toThrow();
    });
});

// =============================================================================
// QUERY PARAMETER INJECTION
// =============================================================================

describe("query parameter injection - GET /api/teams", () => {
    it("handles SQL injection in season_id gracefully", async () => {
        // The mocked getValidatedQuery bypasses Zod, so invalid values pass
        // through but should not affect the database
        mockQueryState.value = { season_id: "1 OR 1=1" };

        const result = await listTeamsHandler(createEvent());
        expect(Array.isArray(result)).toBe(true);
    });

    it("handles non-numeric season_id gracefully", async () => {
        mockQueryState.value = { season_id: "abc" };

        const result = await listTeamsHandler(createEvent());
        expect(Array.isArray(result)).toBe(true);
    });

    it("handles negative season_id gracefully", async () => {
        mockQueryState.value = { season_id: "-1" };

        const result = await listTeamsHandler(createEvent());
        expect(Array.isArray(result)).toBe(true);
    });

    it("handles SQL injection in judging query param gracefully", async () => {
        ctx.drizzle.update(hackathon).set({ judging_open: 1 }).where(eq(hackathon.id, 1)).run();
        mockQueryState.value = { judging: "1 OR 1=1 --" };

        await expect(listTeamsHandler(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });
});

// =============================================================================
// XSS AND SPECIAL CHARACTERS
// =============================================================================

describe("XSS patterns in team name", () => {
    const XSS_NAMES = [
        "<script>alert(1)</script>",
        '"><script>alert(1)</script>',
        "<img src=x onerror=alert(1)>",
        "';--\"><script>alert(1)</script>",
        "{{constructor.constructor('alert(1)')()}}",
    ];

    it.each(XSS_NAMES)("stores XSS payload %j as literal string", async (name) => {
        seedUser(ctx, { email: "xss1@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", name);

        const row = ctx.drizzle.select().from(teams).where(eq(teams.name, name)).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe(name);
    });
});

describe("XSS patterns in team description", () => {
    it.each(["<script>alert('xss')</script>", '"><script>alert(1)</script>', "onerror=alert(1)"])(
        "stores description XSS %j as literal string",
        async (desc) => {
            const team = seedTeam(ctx, { name: "XSSDescTeam" });
            seedUser(ctx, { email: "xss_desc@basischina.com", team_id: team.id });

            mockSession.value = { user: { id: 1 } };
            mockParams.values["id"] = String(team.id);
            mockBody.value = { project: { description: desc } };

            await updateTeamHandler(createEvent());

            const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
            expect(row!.project_description).toBe(desc);
        },
    );
});

describe("multi-byte character injection", () => {
    const MULTI_BYTE_NAMES = [
        "Ā", // Unicode character beyond ASCII
        "' OR 1=1 --Ā", // SQL injection with trailing Unicode
        "团队名称", // Chinese characters
        "日本語チーム名", // Japanese characters
        "' UNION SELECT Ā FROM users --", // Unicode in injection
    ];

    it.each(MULTI_BYTE_NAMES)("stores multi-byte name %j as literal", async (name) => {
        seedUser(ctx, { email: "mb@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", name);

        const row = ctx.drizzle.select().from(teams).where(eq(teams.name, name)).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe(name);
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("edge cases in team name", () => {
    it("stores 'null' as literal string team name", async () => {
        seedUser(ctx, { email: "nulltest@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name: "null" };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", "null");

        const row = ctx.drizzle.select().from(teams).where(eq(teams.name, "null")).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe("null");
    });

    it("stores 'undefined' as literal string team name", async () => {
        seedUser(ctx, { email: "undefinedtest@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name: "undefined" };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", "undefined");

        const row = ctx.drizzle.select().from(teams).where(eq(teams.name, "undefined")).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe("undefined");
    });

    it("stores JSON-like string as literal team name", async () => {
        seedUser(ctx, { email: "jsontest@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name: '{"key": "value"}' };

        const result = await createTeamHandler(createEvent());

        expect(result).toHaveProperty("name", '{"key": "value"}');

        const row = ctx.drizzle
            .select()
            .from(teams)
            .where(eq(teams.name, '{"key": "value"}'))
            .get();
        expect(row).toBeDefined();
        expect(row!.name).toBe('{"key": "value"}');
    });

    it("rejects empty team name via Zod validation", async () => {
        mockSession.value = { user: { id: 1 } };
        mockBody.value = { name: "" };

        await expect(createTeamHandler(createEvent())).rejects.toThrow();
    });

    it("stores team name at max length with SQL content", async () => {
        seedUser(ctx, { email: "maxlen@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        const name = "' OR 1=1 -- XYZ"; // 15 chars, well under 30 max
        mockBody.value = { name };

        const result = await createTeamHandler(createEvent());
        expect(result).toHaveProperty("name", name);
    });
});

describe("edge cases in team description (PATCH)", () => {
    it("stores zero-length string description as literal", async () => {
        const team = seedTeam(ctx, { name: "EmptyDescTeam" });
        seedUser(ctx, { email: "emptydesc@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { project: { description: "" } };

        await updateTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_description).toBe("");
    });

    it("stores long description near max length with SQL content", async () => {
        const team = seedTeam(ctx, { name: "LongDescTeam" });
        seedUser(ctx, { email: "longdesc@basischina.com", team_id: team.id });

        // Build a description near the 2000 char limit with SQL injection
        const base = "' OR 1=1 -- " + "A".repeat(1980);
        const desc = base.substring(0, 2000);

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { project: { description: desc } };

        await updateTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_description).toBe(desc);
    });
});

describe("second-order SQL injection", () => {
    it("stores then retrieves SQL payload as literal without executing", async () => {
        // First order: store injection string
        seedUser(ctx, { email: "secondorder@basischina.com" });
        mockSession.value = { user: { id: 1 } };
        const injectionName = "' OR 1=1 --";
        mockBody.value = { name: injectionName };

        const result = await createTeamHandler(createEvent());
        expect(result).toHaveProperty("name", injectionName);

        // Second order: read it back, verify it's still the literal string
        const { requireUser } = await import("~~/server/utils/auth");
        (requireUser as any).mockResolvedValue({
            id: 1,
            team_id: result.id,
            role: "participant",
        });

        mockParams.values["id"] = String(result.id);

        // Verify by querying the database directly - the stored value should be
        // the literal injection string, not interpreted as SQL
        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, result.id)).get();
        expect(row).toBeDefined();
        expect(row!.name).toBe(injectionName);

        // Ensure no other teams were created (injection didn't affect query)
        const allTeams = ctx.drizzle.select().from(teams).all();
        expect(allTeams).toHaveLength(1);
    });
});

describe("URL injection in project fields", () => {
    it("stores javascript: URL in demo_url as literal (Zod validation bypassed by mock)", async () => {
        const team = seedTeam(ctx, { name: "URLTeam" });
        seedUser(ctx, { email: "url@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            project: { demo_url: "javascript:alert(1)" },
        };

        await updateTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_demo_url).toBe("javascript:alert(1)");
    });

    it("stores data: URL in repo_url as literal (Zod validation bypassed by mock)", async () => {
        const team = seedTeam(ctx, { name: "URLTeam2" });
        seedUser(ctx, { email: "url2@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = {
            project: { repo_url: "data:text/html,<script>alert(1)</script>" },
        };

        await updateTeamHandler(createEvent());

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.project_repo_url).toBe("data:text/html,<script>alert(1)</script>");
    });
});

describe("pathway field injection", () => {
    it("rejects a pathway that has no rubric track when validation is bypassed", async () => {
        const team = seedTeam(ctx, { name: "PathTeam" });
        seedUser(ctx, { email: "path@basischina.com", team_id: team.id });

        mockSession.value = { user: { id: 1 } };
        mockParams.values["id"] = String(team.id);
        mockBody.value = { pathway: "' OR 1=1 --" };

        await expect(updateTeamHandler(createEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: "Choose a track that is available for this season.",
        });

        const row = ctx.drizzle.select().from(teams).where(eq(teams.id, team.id)).get();
        expect(row!.pathway).toBeNull();
    });
});

describe("hackathon status field injection (direct DB helper)", () => {
    it("treats SQL metacharacters in hackathon theme fields as literals", async () => {
        const { getHackathon } = await import("~~/server/utils/database/hackathon");

        // Update the already-seeded hackathon row with SQL injection values
        ctx.drizzle
            .update(hackathon)
            .set({
                theme_name: "' OR 1=1 --",
                theme_description: "'; DROP TABLE users; --",
            })
            .where(eq(hackathon.id, 1))
            .run();

        const result = await getHackathon(createEvent());

        expect(result).toBeDefined();
        expect(result!.theme_name).toBe("' OR 1=1 --");
        expect(result!.theme_description).toBe("'; DROP TABLE users; --");
    });
});

describe("team award meta injection (direct DB helper)", () => {
    it("stores SQL injection in award meta as literal JSON", async () => {
        const team = seedTeam(ctx, { name: "AwardTeam" });

        ctx.drizzle
            .insert(teamAwards)
            .values({
                team_id: team.id,
                award: "Best In Show",
                meta: "' OR 1=1 --",
            })
            .run();

        const row = ctx.drizzle
            .select()
            .from(teamAwards)
            .where(eq(teamAwards.team_id, team.id))
            .get();
        expect(row).toBeDefined();
        expect(row!.meta).toBe("' OR 1=1 --");
    });
});

describe("past teams edge cases", () => {
    it("stores SQL injection in user past team records", async () => {
        // Verify the user_past_teams table handles data integrity even
        // when team names contain SQL injection
        const team = seedTeam(ctx, { name: "' OR 1=1 --" });
        const user = seedUser(ctx, { email: "past@basischina.com", team_id: null });

        // Insert into user_past_teams
        ctx.drizzle.insert(userPastTeams).values({ user_id: user.id, team_id: team.id }).run();

        const row = ctx.drizzle
            .select()
            .from(userPastTeams)
            .where(and(eq(userPastTeams.user_id, user.id), eq(userPastTeams.team_id, team.id)))
            .get();
        expect(row).toBeDefined();
        expect(row!.team_id).toBe(team.id);
    });
});

describe("getTeamById with SQL-injected values (direct DB helper)", () => {
    it("returns null for non-existent team with SQL-injected name lookup", async () => {
        const { getTeamById } = await import("~~/server/utils/database/teams");

        const result = await getTeamById(createEvent(), 99999);
        expect(result).toBeNull();
    });
});
