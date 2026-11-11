import { describe, it, expect } from "vitest";
import {
    CreateTeamQuery,
    GetTeamsQuery,
    CreateTeamRequest,
    UpdateTeamRequest,
    SubmitTeamRequest,
    AddTeamMemberRequest,
    UpdateUserRequest,
    CreateTeamScoresRequest,
    SubmitVoteRequest,
    ManageRedirectUriRequest,
    OAuth2TokenRequest,
    OAuth2SessionActionRequest,
    SetActiveSeasonRequest,
    UpdateSeasonTweaksRequest,
    ElectionVoteRequest,
    ApplicationIdParams,
    TeamIdParams,
    UserIdParams,
    DeepSeekSessionIdParams,
    TeamUserParams,
    DeleteApplicationsRequest,
    formatBytes,
    BasisEmail,
    TeamName,
    ProjectName,
    ProjectDescription,
    ProjectUrl,
    BooleanString,
    PositiveIntParam,
    ZeroToFive,
    ScoreValues,
    MAX_USER_NAME_LENGTH,
    MAX_PROJECT_DESCRIPTION_LENGTH,
    MAX_PROJECT_SOURCE_LENGTH,
    MAX_REASONING_LENGTH,
} from "~~/shared/schemas";

describe("CreateTeamQuery", () => {
    it("accepts add=true", () => {
        const result = CreateTeamQuery.parse({ add: "true" });
        expect(result.add).toBe(true);
    });

    it("accepts add=false", () => {
        const result = CreateTeamQuery.parse({ add: "false" });
        expect(result.add).toBe(false);
    });

    it("has add as undefined when missing", () => {
        const result = CreateTeamQuery.parse({});
        expect(result.add).toBeUndefined();
    });

    it("rejects add with an invalid value", () => {
        expect(() => CreateTeamQuery.parse({ add: "yes" })).toThrow();
    });
});

describe("CreateTeamRequest", () => {
    it("accepts a valid team name", () => {
        expect(() => CreateTeamRequest.parse({ name: "My Team" })).not.toThrow();
    });

    it("accepts a 2-character name", () => {
        expect(() => CreateTeamRequest.parse({ name: "AB" })).not.toThrow();
    });

    it("accepts a 30-character name", () => {
        expect(() => CreateTeamRequest.parse({ name: "A".repeat(30) })).not.toThrow();
    });

    it("rejects a name shorter than 2 characters", () => {
        expect(() => CreateTeamRequest.parse({ name: "A" })).toThrow();
    });

    it("rejects a name longer than 30 characters", () => {
        expect(() => CreateTeamRequest.parse({ name: "A".repeat(31) })).toThrow();
    });

    it("rejects an empty name", () => {
        expect(() => CreateTeamRequest.parse({ name: "" })).toThrow();
    });
});

describe("UpdateTeamRequest", () => {
    it("accepts a valid name update", () => {
        expect(() => UpdateTeamRequest.parse({ name: "New Name" })).not.toThrow();
    });

    it("accepts a valid pathway update", () => {
        expect(() => UpdateTeamRequest.parse({ pathway: "junior" })).not.toThrow();
        expect(() => UpdateTeamRequest.parse({ pathway: "senior" })).not.toThrow();
    });

    it("accepts an empty object", () => {
        expect(() => UpdateTeamRequest.parse({})).not.toThrow();
    });

    it("accepts a configurable track key and rejects malformed track keys", () => {
        expect(() => UpdateTeamRequest.parse({ pathway: "intermediate" })).not.toThrow();
        expect(() => UpdateTeamRequest.parse({ pathway: "Bad Track" })).toThrow();
    });

    it("accepts a valid project update", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: {
                    name: "My Project",
                    description: "A description",
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).not.toThrow();
    });

    it("transforms an empty string URL to null", () => {
        const result = UpdateTeamRequest.parse({
            project: {
                demo_url: "",
                repo_url: "",
            },
        });
        expect(result.project?.demo_url).toBeNull();
        expect(result.project?.repo_url).toBeNull();
    });

    it("preserves null and undefined URLs", () => {
        const resultWithNull = UpdateTeamRequest.parse({
            project: {
                demo_url: null,
                repo_url: undefined,
            },
        });
        expect(resultWithNull.project?.demo_url).toBeNull();
        expect(resultWithNull.project?.repo_url).toBeUndefined();
    });

    it("rejects a project name longer than 100 characters", () => {
        expect(() => UpdateTeamRequest.parse({ project: { name: "A".repeat(101) } })).toThrow();
    });

    it("accepts a long project description (MAX is now Integer.MAX_VALUE)", () => {
        expect(() =>
            UpdateTeamRequest.parse({ project: { description: "A".repeat(5000) } }),
        ).not.toThrow();
    });

    it("rejects an invalid demo URL", () => {
        expect(() => UpdateTeamRequest.parse({ project: { demo_url: "not-a-url" } })).toThrow();
    });

    it("rejects a demo URL longer than 2048 characters", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { demo_url: "https://example.com/" + "a".repeat(2048) },
            }),
        ).toThrow();
    });

    it("enforces the sourcing notes size limit", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { sourcing: "A".repeat(MAX_PROJECT_SOURCE_LENGTH + 1) },
            }),
        ).toThrow();
    });
});

describe("SubmitTeamRequest", () => {
    it("accepts a valid submission", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).not.toThrow();
    });

    it("rejects a submission with missing project name", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "",
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("rejects a submission with too short description", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "Too short",
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("rejects a submission with invalid demo URL", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "not-a-url",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("rejects a submission with invalid repo URL", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "not-a-url",
                },
            }),
        ).toThrow();
    });

    it("rejects a submission with missing pathway", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("rejects a project name longer than 100 characters", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "A".repeat(101),
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("accepts a long project description in submission (MAX now Integer.MAX_VALUE)", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(5000),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).not.toThrow();
    });

    it("rejects a demo URL longer than 2048 characters", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "https://example.com/" + "a".repeat(2048),
                    repo_url: "https://github.com/user/repo",
                },
            }),
        ).toThrow();
    });

    it("enforces the sourcing notes size limit in submission", () => {
        expect(() =>
            SubmitTeamRequest.parse({
                pathway: "junior",
                project: {
                    name: "Cool Project",
                    description: "A".repeat(30),
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                    sourcing: "A".repeat(MAX_PROJECT_SOURCE_LENGTH + 1),
                },
            }),
        ).toThrow();
    });
});

describe("AddTeamMemberRequest", () => {
    it("accepts a valid @basischina.com email", () => {
        expect(() => AddTeamMemberRequest.parse({ email: "member@basischina.com" })).not.toThrow();
    });

    it("rejects a non-basis email", () => {
        expect(() => AddTeamMemberRequest.parse({ email: "member@gmail.com" })).toThrow();
    });

    it("rejects an invalid email format", () => {
        expect(() => AddTeamMemberRequest.parse({ email: "not-an-email" })).toThrow();
    });

    it("rejects an email longer than 254 characters", () => {
        const longLocal = "a".repeat(250);
        expect(() =>
            AddTeamMemberRequest.parse({ email: `${longLocal}@basischina.com` }),
        ).toThrow();
    });
});

describe("UpdateUserRequest", () => {
    it("accepts a valid name update", () => {
        expect(() => UpdateUserRequest.parse({ name: "John Doe" })).not.toThrow();
    });

    it("accepts an empty object (no fields)", () => {
        expect(() => UpdateUserRequest.parse({})).not.toThrow();
    });

    it("accepts a profile_theme_image as null", () => {
        expect(() => UpdateUserRequest.parse({ profile_theme_image: null })).not.toThrow();
    });

    it("accepts a profile_theme_image as a data string", () => {
        expect(() =>
            UpdateUserRequest.parse({ profile_theme_image: "data:image/png;base64,abc" }),
        ).not.toThrow();
    });

    it("accepts a profile_theme_image as a valid File", () => {
        const file = new File([new Uint8Array([1, 2, 3])], "theme.png", { type: "image/png" });
        expect(() => UpdateUserRequest.parse({ profile_theme_image: file })).not.toThrow();
    });

    it("rejects a profile_theme_image File that is too large", () => {
        const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "theme.png", {
            type: "image/png",
        });
        expect(() => UpdateUserRequest.parse({ profile_theme_image: file })).toThrow(
            "smaller than 7 MB",
        );
    });

    it("rejects a profile_theme_image File with an invalid type", () => {
        const file = new File([new Uint8Array([1, 2, 3])], "theme.gif", { type: "image/gif" });
        expect(() => UpdateUserRequest.parse({ profile_theme_image: file })).toThrow(
            "valid image file",
        );
    });

    it("accepts an avatar as null", () => {
        expect(() => UpdateUserRequest.parse({ avatar: null })).not.toThrow();
    });

    it("accepts an avatar as a data string", () => {
        expect(() =>
            UpdateUserRequest.parse({ avatar: "data:image/png;base64,abc" }),
        ).not.toThrow();
    });

    it("accepts an avatar as a valid File", () => {
        const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });
        expect(() => UpdateUserRequest.parse({ avatar: file })).not.toThrow();
    });

    it("rejects an avatar File that is too large", () => {
        const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "avatar.png", {
            type: "image/png",
        });
        expect(() => UpdateUserRequest.parse({ avatar: file })).toThrow("smaller than 7 MB");
    });

    it("rejects an avatar File with an invalid type", () => {
        const file = new File([new Uint8Array([1, 2, 3])], "avatar.gif", { type: "image/gif" });
        expect(() => UpdateUserRequest.parse({ avatar: file })).toThrow("valid image file");
    });

    it("rejects an avatar that is not a data string, null, or File", () => {
        expect(() => UpdateUserRequest.parse({ avatar: "not-data-or-file" })).toThrow();
    });

    it("rejects a name longer than MAX_USER_NAME_LENGTH characters", () => {
        expect(() =>
            UpdateUserRequest.parse({ name: "A".repeat(MAX_USER_NAME_LENGTH + 1) }),
        ).toThrow();
    });

    it("rejects a profile_theme_image that is not a data string, null, or File", () => {
        expect(() =>
            UpdateUserRequest.parse({ profile_theme_image: "not-data-or-file" }),
        ).toThrow();
    });
});

describe("CreateTeamScoresRequest", () => {
    const validScores = {
        originality: 3,
        presentation: 3,
        technicality: 3,
        theme: 3,
        impact: 3,
    };

    it("accepts valid scores with reasoning", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: validScores,
            }),
        ).not.toThrow();
    });

    it("rejects reasoning shorter than 10 characters", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Short",
                scores: validScores,
            }),
        ).toThrow();
    });

    it("accepts long reasoning (MAX now Integer.MAX_VALUE)", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "A".repeat(5000),
                scores: validScores,
            }),
        ).not.toThrow();
    });

    it("rejects a score below 0", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: { ...validScores, originality: -1 },
            }),
        ).toThrow();
    });

    it("rejects a score above 5", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: { ...validScores, originality: 6 },
            }),
        ).toThrow();
    });

    it("rejects missing rubric fields", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: { originality: 3 },
            }),
        ).toThrow();
    });
});

describe("SubmitVoteRequest", () => {
    it("accepts scores that sum to exactly 10", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 5],
                reasoning: "Great work",
            }),
        ).not.toThrow();

        expect(() =>
            SubmitVoteRequest.parse({
                scores: [2, 3, 5],
                reasoning: "Great work",
            }),
        ).not.toThrow();
    });

    it("rejects scores that do not sum to 10", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 4],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("rejects empty scores", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("accepts long reasoning (MAX now Integer.MAX_VALUE)", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 5],
                reasoning: "A".repeat(5000),
            }),
        ).not.toThrow();
    });

    it("rejects a score below 0", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [10, -1, 1],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("rejects a score above 5", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [6, 4],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("rejects scores that sum to 12 (schema requires 10)", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [6, 6],
                reasoning: "Great work",
            }),
        ).toThrow("Stars must sum to 10");
    });

    it("rejects more than 50 scores", () => {
        const scores = Array(51).fill(0);
        scores[0] = 5;
        scores[1] = 5;
        expect(() =>
            SubmitVoteRequest.parse({
                scores,
                reasoning: "Great work",
            }),
        ).toThrow();
    });
});

describe("ManageRedirectUriRequest", () => {
    it("accepts a valid HTTPS URL", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "https://example.com/callback" }),
        ).not.toThrow();
    });

    it("accepts a localhost URL", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://localhost:3000/callback" }),
        ).not.toThrow();
    });

    it("accepts localhost with a path", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://localhost/callback" }),
        ).not.toThrow();
    });

    it("accepts localhost with a port", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://localhost:8080" }),
        ).not.toThrow();
    });

    it("accepts bare localhost origin", () => {
        expect(() => ManageRedirectUriRequest.parse({ uri: "http://localhost" })).not.toThrow();
    });

    it("rejects http://localhost.evil.com", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://localhost.evil.com/callback" }),
        ).toThrow();
    });

    it("rejects a plain HTTP URL", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://example.com/callback" }),
        ).toThrow();
    });

    it("rejects an invalid URL", () => {
        expect(() => ManageRedirectUriRequest.parse({ uri: "not-a-url" })).toThrow();
    });

    it("rejects an empty string", () => {
        expect(() => ManageRedirectUriRequest.parse({ uri: "" })).toThrow();
    });
});

describe("OAuth2TokenRequest", () => {
    it("accepts a valid token request", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).not.toThrow();
    });

    it("accepts optional redirect_uri and code_verifier", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                redirect_uri: "https://example.com/callback",
                code_verifier: "verifier123",
            }),
        ).not.toThrow();
    });

    it("rejects a wrong grant_type", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "client_credentials",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects missing code", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects missing client_id", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects missing client_secret", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
            }),
        ).toThrow();
    });

    it("rejects empty code", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects a code longer than 1024 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "a".repeat(1025),
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects a client_id longer than 256 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "a".repeat(257),
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("rejects a client_secret longer than 512 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "a".repeat(513),
            }),
        ).toThrow();
    });

    it("rejects a redirect_uri longer than 2048 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                redirect_uri: "https://example.com/" + "a".repeat(2048),
            }),
        ).toThrow();
    });

    it("rejects a code_verifier longer than 128 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                code_verifier: "a".repeat(129),
            }),
        ).toThrow();
    });
});

describe("OAuth2SessionActionRequest", () => {
    it("accepts a valid cancel action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "cancel" })).not.toThrow();
    });

    it("accepts a valid consent action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "consent" })).not.toThrow();
    });

    it("accepts a valid assume_consent action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "assume_consent" })).not.toThrow();
    });

    it("accepts a valid deny action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "deny" })).not.toThrow();
    });

    it("rejects an invalid action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "approve" })).toThrow();
    });

    it("rejects an empty action", () => {
        expect(() => OAuth2SessionActionRequest.parse({ action: "" })).toThrow();
    });
});

describe("SetActiveSeasonRequest", () => {
    it("accepts a valid season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: 1 })).not.toThrow();
    });

    it("accepts null season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: null })).not.toThrow();
    });

    it("rejects 0 as season_id (not positive)", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: 0 })).toThrow();
    });

    it("rejects a negative season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: -1 })).toThrow();
    });

    it("rejects a non-integer season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: 1.5 })).toThrow();
    });
});

describe("UpdateSeasonTweaksRequest", () => {
    it("accepts a single toggle", () => {
        expect(() => UpdateSeasonTweaksRequest.parse({ show_scores: true })).not.toThrow();
    });

    it("accepts all fields together", () => {
        expect(() =>
            UpdateSeasonTweaksRequest.parse({
                status: "voting",
                show_scores: true,
                show_ranking: true,
            }),
        ).not.toThrow();
    });

    it("rejects an empty object", () => {
        expect(() => UpdateSeasonTweaksRequest.parse({})).toThrow();
    });

    it("rejects an invalid status", () => {
        expect(() => UpdateSeasonTweaksRequest.parse({ status: "bogus" })).toThrow();
    });

    it("strips non-tweakable fields", () => {
        const parsed = UpdateSeasonTweaksRequest.parse({
            show_scores: true,
            theme_name: "Hacked",
            voting_enabled: true,
        } as any);

        expect(parsed).toEqual({ show_scores: true });
    });

    it("rejects a non-boolean toggle", () => {
        expect(() => UpdateSeasonTweaksRequest.parse({ show_scores: 1 })).toThrow();
    });
});

describe("ElectionVoteRequest", () => {
    it("accepts valid votes", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [
                            { id: "c1", rank: 1 },
                            { id: "c2", rank: 2 },
                        ],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts candidates with null rank", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [
                            { id: "c1", rank: null },
                            { id: "c2", rank: 1 },
                        ],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts empty positions array", () => {
        expect(() => ElectionVoteRequest.parse({ positions: [] })).not.toThrow();
    });

    it("rejects candidates with rank below 1", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "c1", rank: 0 }],
                    },
                ],
            }),
        ).toThrow();
    });

    it("rejects non-integer rank", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "c1", rank: 1.5 }],
                    },
                ],
            }),
        ).toThrow();
    });

    it("rejects more than 20 positions", () => {
        const positions = Array(21).fill({
            title: "Position",
            candidates: [{ id: "c1", rank: 1 }],
        });
        expect(() => ElectionVoteRequest.parse({ positions })).toThrow();
    });

    it("rejects more than 50 candidates in a position", () => {
        const candidates = Array(51).fill({ id: "c1", rank: 1 });
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [{ title: "President", candidates }],
            }),
        ).toThrow();
    });

    it("rejects a position title longer than 128 characters", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "A".repeat(129),
                        candidates: [{ id: "c1", rank: 1 }],
                    },
                ],
            }),
        ).toThrow();
    });

    it("rejects a candidate ID longer than 64 characters", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "a".repeat(65), rank: 1 }],
                    },
                ],
            }),
        ).toThrow();
    });
});

describe("GetTeamsQuery", () => {
    it("accepts valid judging and season_id", () => {
        const result = GetTeamsQuery.parse({ judging: "true", season_id: "1" });
        expect(result.judging).toBe(true);
        expect(result.season_id).toBe(1);
    });

    it("accepts a bounded judging page", () => {
        const result = GetTeamsQuery.parse({ judging: "true", page: "2", page_size: "25" });
        expect(result.page).toBe(2);
        expect(result.page_size).toBe(25);
    });

    it("accepts an empty query", () => {
        const result = GetTeamsQuery.parse({});
        expect(result.judging).toBeUndefined();
        expect(result.season_id).toBeUndefined();
    });

    it("rejects an invalid season_id", () => {
        expect(() => GetTeamsQuery.parse({ season_id: "not-a-number" })).toThrow();
    });

    it("rejects a non-positive season_id", () => {
        expect(() => GetTeamsQuery.parse({ season_id: "0" })).toThrow();
    });

    it("rejects unbounded or invalid judging pagination", () => {
        expect(() => GetTeamsQuery.parse({ page: "0" })).toThrow();
        expect(() => GetTeamsQuery.parse({ page_size: "51" })).toThrow();
        expect(() => GetTeamsQuery.parse({ page: "1.5" })).toThrow();
    });
});

describe("ApplicationIdParams", () => {
    it("accepts a valid client_id", () => {
        expect(() => ApplicationIdParams.parse({ id: "my-client" })).not.toThrow();
    });

    it("rejects an empty client_id", () => {
        expect(() => ApplicationIdParams.parse({ id: "" })).toThrow();
    });

    it("rejects a client_id longer than 256 characters", () => {
        expect(() => ApplicationIdParams.parse({ id: "a".repeat(257) })).toThrow();
    });
});

describe("TeamIdParams", () => {
    it("accepts a positive integer id", () => {
        expect(() => TeamIdParams.parse({ id: "1" })).not.toThrow();
    });

    it("rejects a non-numeric id", () => {
        expect(() => TeamIdParams.parse({ id: "abc" })).toThrow();
    });

    it("rejects a negative id", () => {
        expect(() => TeamIdParams.parse({ id: "-1" })).toThrow();
    });
});

describe("UserIdParams", () => {
    it("accepts a positive integer id", () => {
        expect(() => UserIdParams.parse({ id: "1" })).not.toThrow();
    });

    it("rejects a non-numeric id", () => {
        expect(() => UserIdParams.parse({ id: "abc" })).toThrow();
    });
});

describe("DeepSeekSessionIdParams", () => {
    it("accepts a positive integer id", () => {
        expect(() => DeepSeekSessionIdParams.parse({ id: "1" })).not.toThrow();
    });

    it("rejects a non-numeric id", () => {
        expect(() => DeepSeekSessionIdParams.parse({ id: "abc" })).toThrow();
    });
});

describe("formatBytes", () => {
    it("returns 0 Bytes for zero", () => {
        expect(formatBytes(0)).toBe("0 Bytes");
    });

    it("formats bytes with default decimals", () => {
        expect(formatBytes(1024)).toBe("1 KB");
    });

    it("clamps negative decimals to zero", () => {
        expect(formatBytes(1536, -1)).toBe("2 KB");
    });

    it("uses the requested number of decimals", () => {
        expect(formatBytes(1536, 2)).toBe("1.5 KB");
    });

    it("formats 1 byte", () => {
        expect(formatBytes(1)).toBe("1 Bytes");
    });

    it("formats 1023 bytes as Bytes", () => {
        expect(formatBytes(1023)).toBe("1023 Bytes");
    });

    it("formats 1048576 as 1 MB", () => {
        expect(formatBytes(1048576)).toBe("1 MB");
    });

    it("formats 1073741824 as 1 GB", () => {
        expect(formatBytes(1073741824)).toBe("1 GB");
    });

    it("formats 1099511627776 as 1 TB", () => {
        expect(formatBytes(1099511627776)).toBe("1 TB");
    });

    it("formats with 0 decimals when requested", () => {
        expect(formatBytes(1536, 0)).toBe("2 KB");
    });

    it("formats 1572864 as 1.5 MB with 1 decimal", () => {
        expect(formatBytes(1572864, 1)).toBe("1.5 MB");
    });

    it("formats a very large number", () => {
        expect(formatBytes(1125899906842624)).toBe("1 PB");
    });
});

describe("BasisEmail", () => {
    it("accepts an email with uppercase local part", () => {
        expect(() => BasisEmail.parse("User@basischina.com")).not.toThrow();
    });

    it("accepts an email with uppercase domain", () => {
        expect(() => BasisEmail.parse("user@BASISCHINA.COM")).not.toThrow();
    });

    it("accepts an email at exactly max length", () => {
        const localLen = 254 - "@basischina.com".length;
        const email = "a".repeat(localLen) + "@basischina.com";
        expect(email.length).toBe(254);
        expect(() => BasisEmail.parse(email)).not.toThrow();
    });

    it("rejects an email exceeding max length", () => {
        const localLen = 254 - "@basischina.com".length + 1;
        const email = "a".repeat(localLen) + "@basischina.com";
        expect(() => BasisEmail.parse(email)).toThrow();
    });

    it("rejects a @gmail.com email", () => {
        expect(() => BasisEmail.parse("test@gmail.com")).toThrow();
    });

    it("rejects a @outlook.com email", () => {
        expect(() => BasisEmail.parse("test@outlook.com")).toThrow();
    });

    it("rejects a @yahoo.com email", () => {
        expect(() => BasisEmail.parse("test@yahoo.com")).toThrow();
    });

    it("rejects an email with a subdomain (not @basischina.com)", () => {
        expect(() => BasisEmail.parse("test@sub.basischina.com")).toThrow();
    });

    it("rejects an email with a multi-level subdomain", () => {
        expect(() => BasisEmail.parse("test@a.b.basischina.com")).toThrow();
    });

    it("accepts an email with dots in the local part", () => {
        expect(() => BasisEmail.parse("test.user@basischina.com")).not.toThrow();
    });

    it("accepts an email with a plus tag", () => {
        expect(() => BasisEmail.parse("test+tag@basischina.com")).not.toThrow();
    });

    it("accepts an email with numbers in the local part", () => {
        expect(() => BasisEmail.parse("test123@basischina.com")).not.toThrow();
    });
});

describe("TeamName", () => {
    it("accepts a name with unicode (Chinese)", () => {
        expect(() => TeamName.parse("团队名称")).not.toThrow();
    });

    it("accepts a name with unicode (Japanese)", () => {
        expect(() => TeamName.parse("チーム名")).not.toThrow();
    });

    it("accepts a name with emoji", () => {
        expect(() => TeamName.parse("Team 🚀")).not.toThrow();
    });

    it("accepts a name with a hyphen", () => {
        expect(() => TeamName.parse("Team-Name")).not.toThrow();
    });

    it("accepts a name with an apostrophe", () => {
        expect(() => TeamName.parse("Team's Name")).not.toThrow();
    });

    it("accepts a numeric name", () => {
        expect(() => TeamName.parse("123456")).not.toThrow();
    });

    it("accepts a name with spaces", () => {
        expect(() => TeamName.parse("My Super Team")).not.toThrow();
    });

    it("accepts a name with special characters", () => {
        expect(() => TeamName.parse("Team #1 & Co.")).not.toThrow();
    });

    it("accepts a name with leading space", () => {
        expect(() => TeamName.parse(" Leading")).not.toThrow();
    });

    it("accepts a name with trailing space", () => {
        expect(() => TeamName.parse("Trailing ")).not.toThrow();
    });

    it("accepts a name with Cyrillic characters", () => {
        expect(() => TeamName.parse("Команда")).not.toThrow();
    });

    it("rejects a name with only one character", () => {
        expect(() => TeamName.parse("A")).toThrow();
    });

    it("rejects a name longer than 30 characters", () => {
        expect(() => TeamName.parse("A".repeat(31))).toThrow();
    });

    it("rejects a name longer than MAX_USER_NAME_LENGTH characters", () => {
        expect(() => TeamName.parse("A".repeat(MAX_USER_NAME_LENGTH + 1))).toThrow();
    });
});

describe("ProjectName", () => {
    it("accepts a 1-character name", () => {
        expect(() => ProjectName.parse("A")).not.toThrow();
    });

    it("accepts a 100-character name", () => {
        expect(() => ProjectName.parse("A".repeat(100))).not.toThrow();
    });

    it("rejects a 101-character name", () => {
        expect(() => ProjectName.parse("A".repeat(101))).toThrow();
    });

    it("rejects an empty name", () => {
        expect(() => ProjectName.parse("")).toThrow();
    });

    it("accepts a name with unicode", () => {
        expect(() => ProjectName.parse("我的项目")).not.toThrow();
    });

    it("accepts a name with special characters", () => {
        expect(() => ProjectName.parse("Project #1: Hello!")).not.toThrow();
    });

    it("accepts a name with spaces", () => {
        expect(() => ProjectName.parse("My Awesome Project")).not.toThrow();
    });

    it("accepts a numeric name", () => {
        expect(() => ProjectName.parse("1234567890")).not.toThrow();
    });

    it("accepts a name with dots and hyphens", () => {
        expect(() => ProjectName.parse("project.v2-final")).not.toThrow();
    });

    it("accepts a name with emoji", () => {
        expect(() => ProjectName.parse("Cool Project ✨")).not.toThrow();
    });
});

describe("ProjectDescription", () => {
    it("accepts exactly 30 characters", () => {
        expect(() => ProjectDescription.parse("A".repeat(30))).not.toThrow();
    });

    it("accepts 2000 characters", () => {
        expect(() => ProjectDescription.parse("A".repeat(2000))).not.toThrow();
    });

    it("accepts 5000 characters (MAX now Integer.MAX_VALUE)", () => {
        expect(() => ProjectDescription.parse("A".repeat(5000))).not.toThrow();
    });

    it("rejects 29 characters", () => {
        expect(() => ProjectDescription.parse("A".repeat(29))).toThrow();
    });

    it("rejects a very short description", () => {
        expect(() => ProjectDescription.parse("Short")).toThrow();
    });

    it("accepts unicode text", () => {
        const desc = "这是一个项目描述，用于测试Unicode字符支持情况是否正常运作中。";
        expect(() => ProjectDescription.parse(desc)).not.toThrow();
    });

    it("accepts multi-line text", () => {
        const desc = "Line one.\nLine two.\nLine three.\n".repeat(10);
        expect(() => ProjectDescription.parse(desc)).not.toThrow();
    });

    it("accepts markdown-like content", () => {
        const desc = "# Title\n\nThis is **bold** and *italic*.\n- List item\n- Another".repeat(3);
        expect(() => ProjectDescription.parse(desc)).not.toThrow();
    });

    it("accepts numeric content", () => {
        expect(() => ProjectDescription.parse("1234567890 ".repeat(3))).not.toThrow();
    });

    it("accepts content with special symbols", () => {
        expect(() =>
            ProjectDescription.parse("Special: @#$%^&*()_+-=[]{}|;':\",./<>?~`".repeat(2)),
        ).not.toThrow();
    });
});

describe("ProjectUrl", () => {
    it("accepts a valid https URL with path", () => {
        expect(() => ProjectUrl.parse("https://example.com/path/to/page")).not.toThrow();
    });

    it("accepts a URL with query parameters", () => {
        expect(() => ProjectUrl.parse("https://example.com/page?foo=bar&baz=qux")).not.toThrow();
    });

    it("accepts a URL at exactly max length", () => {
        const base = "https://example.com/";
        const padding = "a".repeat(2048 - base.length);
        expect(() => ProjectUrl.parse(base + padding)).not.toThrow();
    });

    it("rejects a URL exceeding max length", () => {
        const base = "https://example.com/";
        const padding = "a".repeat(2048 - base.length + 1);
        expect(() => ProjectUrl.parse(base + padding)).toThrow();
    });

    it("accepts a URL with an IP address", () => {
        expect(() => ProjectUrl.parse("https://192.168.1.1/path")).not.toThrow();
    });

    it("accepts a URL with a port number", () => {
        expect(() => ProjectUrl.parse("https://example.com:8080/path")).not.toThrow();
    });

    it("accepts a URL with a fragment", () => {
        expect(() => ProjectUrl.parse("https://example.com/page#section")).not.toThrow();
    });

    it("accepts an empty string", () => {
        expect(() => ProjectUrl.parse("")).not.toThrow();
    });

    it.each([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://user:password@example.com/path",
    ])("rejects unsafe external URL %s", (value) => {
        expect(() => ProjectUrl.parse(value)).toThrow();
    });

    it("accepts a URL with subdomain", () => {
        expect(() => ProjectUrl.parse("https://sub.example.com/path")).not.toThrow();
    });

    it("accepts a URL with a deep path", () => {
        expect(() => ProjectUrl.parse("https://example.com/a/b/c/d/e/f/g/h")).not.toThrow();
    });
});

describe("PositiveIntParam", () => {
    it("parses 1 as 1", () => {
        expect(PositiveIntParam.parse("1")).toBe(1);
    });

    it("parses 42 as 42", () => {
        expect(PositiveIntParam.parse("42")).toBe(42);
    });

    it("parses a large number", () => {
        expect(PositiveIntParam.parse("999999999")).toBe(999999999);
    });

    it("rejects 0", () => {
        expect(() => PositiveIntParam.parse("0")).toThrow();
    });

    it("rejects a negative number", () => {
        expect(() => PositiveIntParam.parse("-1")).toThrow();
    });

    it("rejects a float", () => {
        expect(() => PositiveIntParam.parse("1.5")).toThrow();
    });

    it("rejects a non-numeric string", () => {
        expect(() => PositiveIntParam.parse("abc")).toThrow();
    });

    it("rejects an empty string", () => {
        expect(() => PositiveIntParam.parse("")).toThrow();
    });

    it("rejects Infinity", () => {
        expect(() => PositiveIntParam.parse("Infinity")).toThrow();
    });

    it("rejects a negative float", () => {
        expect(() => PositiveIntParam.parse("-1.5")).toThrow();
    });

    it("rejects NaN", () => {
        expect(() => PositiveIntParam.parse("NaN")).toThrow();
    });
});

describe("BooleanString", () => {
    it('transforms "true" to true', () => {
        expect(BooleanString.parse("true")).toBe(true);
    });

    it('transforms "false" to false', () => {
        expect(BooleanString.parse("false")).toBe(false);
    });

    it('rejects uppercase "TRUE"', () => {
        expect(() => BooleanString.parse("TRUE")).toThrow();
    });

    it('rejects capitalized "True"', () => {
        expect(() => BooleanString.parse("True")).toThrow();
    });

    it('rejects uppercase "FALSE"', () => {
        expect(() => BooleanString.parse("FALSE")).toThrow();
    });

    it('rejects "1"', () => {
        expect(() => BooleanString.parse("1")).toThrow();
    });

    it('rejects "0"', () => {
        expect(() => BooleanString.parse("0")).toThrow();
    });

    it('rejects "yes"', () => {
        expect(() => BooleanString.parse("yes")).toThrow();
    });

    it('rejects "no"', () => {
        expect(() => BooleanString.parse("no")).toThrow();
    });

    it("rejects an empty string", () => {
        expect(() => BooleanString.parse("")).toThrow();
    });
});

describe("ZeroToFive", () => {
    it("accepts 0", () => {
        expect(() => ZeroToFive.parse(0)).not.toThrow();
    });

    it("accepts 3", () => {
        expect(() => ZeroToFive.parse(3)).not.toThrow();
    });

    it("accepts 5", () => {
        expect(() => ZeroToFive.parse(5)).not.toThrow();
    });

    it("rejects -1", () => {
        expect(() => ZeroToFive.parse(-1)).toThrow();
    });

    it("rejects 6", () => {
        expect(() => ZeroToFive.parse(6)).toThrow();
    });

    it("rejects 2.5 (non-integer)", () => {
        expect(() => ZeroToFive.parse(2.5)).toThrow();
    });
});

describe("ScoreValues", () => {
    const allZero = { originality: 0, presentation: 0, technicality: 0, theme: 0, impact: 0 };
    const allFive = { originality: 5, presentation: 5, technicality: 5, theme: 5, impact: 5 };
    const allThree = { originality: 3, presentation: 3, technicality: 3, theme: 3, impact: 3 };

    it("accepts all zeros", () => {
        expect(() => ScoreValues.parse(allZero)).not.toThrow();
    });

    it("accepts all fives", () => {
        expect(() => ScoreValues.parse(allFive)).not.toThrow();
    });

    it("accepts all threes", () => {
        expect(() => ScoreValues.parse(allThree)).not.toThrow();
    });

    it("accepts mixed valid values", () => {
        expect(() =>
            ScoreValues.parse({
                originality: 4,
                presentation: 2,
                technicality: 5,
                theme: 1,
                impact: 0,
            }),
        ).not.toThrow();
    });

    it("rejects a negative score", () => {
        expect(() => ScoreValues.parse({ ...allThree, originality: -1 })).toThrow();
    });

    it("rejects a score above 5", () => {
        expect(() => ScoreValues.parse({ ...allThree, impact: 6 })).toThrow();
    });

    it("rejects a float score", () => {
        expect(() => ScoreValues.parse({ ...allThree, presentation: 2.5 })).toThrow();
    });

    it("rejects a missing key", () => {
        expect(() =>
            ScoreValues.parse({ originality: 3, presentation: 3, technicality: 3, theme: 3 }),
        ).toThrow();
    });

    it("rejects a string value", () => {
        expect(() => ScoreValues.parse({ ...allThree, originality: "bad" })).toThrow();
    });

    it("rejects an empty object", () => {
        expect(() => ScoreValues.parse({})).toThrow();
    });
});

describe("SubmitVoteRequest - additional", () => {
    it("accepts 10 scores of 1 (sum=10)", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: Array(10).fill(1),
                reasoning: "Great work",
            }),
        ).not.toThrow();
    });

    it("accepts 1+2+3+4=10", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [1, 2, 3, 4],
                reasoning: "Great work",
            }),
        ).not.toThrow();
    });

    it("accepts 50 scores summing to 10", () => {
        const scores = Array(48).fill(0);
        scores.push(5, 5);
        expect(() =>
            SubmitVoteRequest.parse({
                scores,
                reasoning: "Great work",
            }),
        ).not.toThrow();
    });

    it("rejects all zeros (sum=0)", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [0, 0],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("rejects a float score", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [2.5, 7.5],
                reasoning: "Great work",
            }),
        ).toThrow();
    });

    it("accepts an empty reasoning string", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 5],
                reasoning: "",
            }),
        ).not.toThrow();
    });

    it("accepts reasoning at exactly 2000 characters", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 5],
                reasoning: "A".repeat(2000),
            }),
        ).not.toThrow();
    });

    it("accepts long reasoning (MAX now Integer.MAX_VALUE)", () => {
        expect(() =>
            SubmitVoteRequest.parse({
                scores: [5, 5],
                reasoning: "A".repeat(5000),
            }),
        ).not.toThrow();
    });
});

describe("OAuth2TokenRequest - additional", () => {
    it("accepts an empty redirect_uri literal", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                redirect_uri: "",
            }),
        ).not.toThrow();
    });

    it("accepts code at exactly 1024 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "a".repeat(1024),
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).not.toThrow();
    });

    it("accepts client_id at exactly 256 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "a".repeat(256),
                client_secret: "my-secret",
            }),
        ).not.toThrow();
    });

    it("accepts client_secret at exactly 512 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "a".repeat(512),
            }),
        ).not.toThrow();
    });

    it("accepts code_verifier at exactly 128 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                code_verifier: "a".repeat(128),
            }),
        ).not.toThrow();
    });

    it("accepts redirect_uri at exactly 2048 characters", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                redirect_uri: "https://example.com/" + "a".repeat(2022),
            }),
        ).not.toThrow();
    });

    it("accepts unknown extra fields (stripped)", () => {
        const result = OAuth2TokenRequest.parse({
            grant_type: "authorization_code",
            code: "abc123",
            client_id: "my-client",
            client_secret: "my-secret",
            extra_field: "should be stripped",
        });
        expect((result as any).extra_field).toBeUndefined();
    });

    it("rejects missing grant_type", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).toThrow();
    });

    it("accepts a numeric code_verifier", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
                code_verifier: "1234567890",
            }),
        ).not.toThrow();
    });

    it("accepts redirect_uri as undefined", () => {
        expect(() =>
            OAuth2TokenRequest.parse({
                grant_type: "authorization_code",
                code: "abc123",
                client_id: "my-client",
                client_secret: "my-secret",
            }),
        ).not.toThrow();
    });
});

describe("ManageRedirectUriRequest - additional", () => {
    it("accepts https with a port number", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "https://example.com:8443/callback" }),
        ).not.toThrow();
    });

    it("accepts https with query parameters", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({
                uri: "https://example.com/callback?state=abc&code=123",
            }),
        ).not.toThrow();
    });

    it("accepts https with a fragment", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "https://example.com/callback#section" }),
        ).not.toThrow();
    });

    it("accepts localhost with query parameters", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://localhost:3000/callback?state=abc" }),
        ).not.toThrow();
    });

    it("accepts https://localhost (starts with https)", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "https://localhost/callback" }),
        ).not.toThrow();
    });

    it("accepts https with a deep path", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "https://example.com/a/b/c/d/e/f/callback" }),
        ).not.toThrow();
    });

    it("rejects http://127.0.0.1 (not localhost)", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://127.0.0.1/callback" }),
        ).toThrow();
    });

    it("rejects case-variant http://LOCALHOST", () => {
        expect(() =>
            ManageRedirectUriRequest.parse({ uri: "http://LOCALHOST/callback" }),
        ).toThrow();
    });

    it("rejects ws:// protocol", () => {
        expect(() => ManageRedirectUriRequest.parse({ uri: "ws://localhost/callback" })).toThrow();
    });

    it("rejects ftp:// protocol", () => {
        expect(() => ManageRedirectUriRequest.parse({ uri: "ftp://localhost/file" })).toThrow();
    });
});

describe("UpdateUserRequest - additional", () => {
    it("accepts a name of exactly 30 characters", () => {
        expect(() => UpdateUserRequest.parse({ name: "A".repeat(30) })).not.toThrow();
    });

    it("accepts a name with unicode", () => {
        expect(() => UpdateUserRequest.parse({ name: "用户名称" })).not.toThrow();
    });

    it("accepts a name with special characters", () => {
        expect(() => UpdateUserRequest.parse({ name: "John O'Brien-Smith" })).not.toThrow();
    });

    it("accepts both profile_theme_image and avatar set to null", () => {
        expect(() =>
            UpdateUserRequest.parse({ profile_theme_image: null, avatar: null }),
        ).not.toThrow();
    });

    it("accepts a name as an empty string", () => {
        expect(() => UpdateUserRequest.parse({ name: "" })).not.toThrow();
    });

    it("accepts a profile_theme_image as a data JPEG URL", () => {
        expect(() =>
            UpdateUserRequest.parse({ profile_theme_image: "data:image/jpeg;base64,xyz" }),
        ).not.toThrow();
    });

    it("accepts an avatar as a data JPEG URL", () => {
        expect(() =>
            UpdateUserRequest.parse({ avatar: "data:image/jpeg;base64,xyz" }),
        ).not.toThrow();
    });

    it("accepts unknown extra fields (stripped)", () => {
        const result = UpdateUserRequest.parse({
            name: "John",
            extra: "should be stripped",
        });
        expect((result as any).extra).toBeUndefined();
    });

    it("accepts a name with numbers", () => {
        expect(() => UpdateUserRequest.parse({ name: "User 123" })).not.toThrow();
    });

    it("rejects a name longer than MAX_USER_NAME_LENGTH characters", () => {
        expect(() =>
            UpdateUserRequest.parse({ name: "A".repeat(MAX_USER_NAME_LENGTH + 1) }),
        ).toThrow();
    });
});

describe("UpdateTeamRequest - additional", () => {
    it("accepts a name with unicode", () => {
        expect(() => UpdateTeamRequest.parse({ name: "新团队" })).not.toThrow();
    });

    it("accepts a name with special characters", () => {
        expect(() => UpdateTeamRequest.parse({ name: "Team #42 & Friends" })).not.toThrow();
    });

    it("accepts a partial project with only name", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { name: "My Project" },
            }),
        ).not.toThrow();
    });

    it("accepts a partial project with only description", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { description: "A valid description text here" },
            }),
        ).not.toThrow();
    });

    it("accepts a partial project with only demo_url", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { demo_url: "https://example.com" },
            }),
        ).not.toThrow();
    });

    it("accepts a partial project with only repo_url", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { repo_url: "https://github.com/user/repo" },
            }),
        ).not.toThrow();
    });

    it("accepts sourcing as an empty string", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: {
                    name: "Project",
                    description: "A valid description",
                    demo_url: "https://example.com",
                    repo_url: "https://github.com/user/repo",
                    sourcing: "",
                },
            }),
        ).not.toThrow();
    });

    it("accepts a description at exactly 2000 characters", () => {
        expect(() =>
            UpdateTeamRequest.parse({
                project: { description: "A".repeat(2000) },
            }),
        ).not.toThrow();
    });

    it("accepts a demo_url at exactly 2048 characters", () => {
        const base = "https://example.com/";
        const padding = "a".repeat(2048 - base.length);
        expect(() =>
            UpdateTeamRequest.parse({
                project: { demo_url: base + padding },
            }),
        ).not.toThrow();
    });

    it("transforms an empty repo_url to null", () => {
        const result = UpdateTeamRequest.parse({
            project: { repo_url: "" },
        });
        expect(result.project?.repo_url).toBeNull();
    });
});

describe("ElectionVoteRequest - additional", () => {
    it("accepts multiple positions", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [
                            { id: "c1", rank: 1 },
                            { id: "c2", rank: 2 },
                        ],
                    },
                    {
                        title: "Treasurer",
                        candidates: [
                            { id: "c3", rank: 1 },
                            { id: "c4", rank: 2 },
                        ],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts candidates with sequential ranks", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [
                            { id: "c1", rank: 1 },
                            { id: "c2", rank: 2 },
                            { id: "c3", rank: 3 },
                        ],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts rank of exactly 1 (minimum)", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "c1", rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts a large rank number", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "c1", rank: 999 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts a position title at exactly 128 characters", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "A".repeat(128),
                        candidates: [{ id: "c1", rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts a candidate ID at exactly 64 characters", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "a".repeat(64), rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts an empty position title string", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "",
                        candidates: [{ id: "c1", rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts an empty candidate ID string", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "", rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts one position with one candidate", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [{ id: "c1", rank: 1 }],
                    },
                ],
            }),
        ).not.toThrow();
    });

    it("accepts duplicate ranks for different candidates", () => {
        expect(() =>
            ElectionVoteRequest.parse({
                positions: [
                    {
                        title: "President",
                        candidates: [
                            { id: "c1", rank: 1 },
                            { id: "c2", rank: 1 },
                        ],
                    },
                ],
            }),
        ).not.toThrow();
    });
});

describe("DeleteApplicationsRequest", () => {
    it("accepts a single ID", () => {
        expect(() => DeleteApplicationsRequest.parse({ ids: ["app-1"] })).not.toThrow();
    });

    it("accepts multiple IDs", () => {
        expect(() =>
            DeleteApplicationsRequest.parse({ ids: ["app-1", "app-2", "app-3"] }),
        ).not.toThrow();
    });

    it("accepts exactly 100 IDs", () => {
        const ids = Array(100).fill("a");
        expect(() => DeleteApplicationsRequest.parse({ ids })).not.toThrow();
    });

    it("rejects more than 100 IDs", () => {
        const ids = Array(101).fill("a");
        expect(() => DeleteApplicationsRequest.parse({ ids })).toThrow();
    });

    it("accepts an empty array", () => {
        expect(() => DeleteApplicationsRequest.parse({ ids: [] })).not.toThrow();
    });

    it("rejects an array with an empty string ID", () => {
        expect(() => DeleteApplicationsRequest.parse({ ids: [""] })).toThrow();
    });
});

describe("TeamUserParams", () => {
    it("accepts valid id and user", () => {
        expect(() => TeamUserParams.parse({ id: "1", user: "2" })).not.toThrow();
    });

    it("rejects a non-numeric id", () => {
        expect(() => TeamUserParams.parse({ id: "abc", user: "1" })).toThrow();
    });

    it("rejects a non-numeric user", () => {
        expect(() => TeamUserParams.parse({ id: "1", user: "abc" })).toThrow();
    });

    it("rejects a negative id", () => {
        expect(() => TeamUserParams.parse({ id: "-1", user: "1" })).toThrow();
    });

    it("rejects a negative user", () => {
        expect(() => TeamUserParams.parse({ id: "1", user: "-1" })).toThrow();
    });

    it("rejects zero id", () => {
        expect(() => TeamUserParams.parse({ id: "0", user: "1" })).toThrow();
    });
});

describe("SetActiveSeasonRequest - additional", () => {
    it("accepts a large positive season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: 999999 })).not.toThrow();
    });

    it("rejects a float season_id", () => {
        expect(() => SetActiveSeasonRequest.parse({ season_id: 1.5 })).toThrow();
    });
});

describe("CreateTeamScoresRequest - additional", () => {
    const validScores = {
        originality: 3,
        presentation: 3,
        technicality: 3,
        theme: 3,
        impact: 3,
    };

    it("accepts reasoning at exactly 10 characters (minimum)", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "A".repeat(10),
                scores: validScores,
            }),
        ).not.toThrow();
    });

    it("accepts reasoning at exactly 2000 characters (maximum)", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "A".repeat(2000),
                scores: validScores,
            }),
        ).not.toThrow();
    });

    it("accepts all zero scores", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: { originality: 0, presentation: 0, technicality: 0, theme: 0, impact: 0 },
            }),
        ).not.toThrow();
    });

    it("accepts all five scores", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Excellent work overall",
                scores: { originality: 5, presentation: 5, technicality: 5, theme: 5, impact: 5 },
            }),
        ).not.toThrow();
    });

    it("rejects a float score", () => {
        expect(() =>
            CreateTeamScoresRequest.parse({
                reasoning: "Good work overall",
                scores: { ...validScores, originality: 2.5 },
            }),
        ).toThrow();
    });
});
