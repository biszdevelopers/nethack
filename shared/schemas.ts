import z from "zod";
import rubrics, { type RubricDefinition } from "./rubric";
import { hasUnfilledCommentTemplate, MIN_JUDGE_COMMENT_LENGTH } from "./judge-comments";

export const MAX_EMAIL_LENGTH = 254;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 10_000;
export const MAX_PROJECT_SOURCE_LENGTH = 2_000;
export const MAX_URL_LENGTH = 2048;
export const MAX_USER_NAME_LENGTH = 50;
export const MAX_OAUTH2_CODE_LENGTH = 1024;
export const MAX_CLIENT_ID_LENGTH = 256;
export const MAX_CLIENT_SECRET_LENGTH = 512;
export const MAX_CODE_VERIFIER_LENGTH = 128;
export const MAX_REDIRECT_URI_LENGTH = 2048;
export const MAX_SCOPE_LENGTH = 128;
export const MAX_SECRET_ABBREVIATED_LENGTH = 16;
export const MAX_REASONING_LENGTH = 10_000;
export const MAX_VOTE_SCORES = 200;
export const MAX_ELECTION_POSITIONS = 20;
export const MAX_ELECTION_CANDIDATES = 50;
export const MAX_ELECTION_TITLE_LENGTH = 128;
export const MAX_ELECTION_CANDIDATE_ID_LENGTH = 64;
export const MAX_BULK_DELETE_IDS = 100;
/** Largest value a PostgreSQL `integer` column accepts. */
export const POSTGRES_INT_MAX = 2_147_483_647;

export const BasisEmail = z
    .email()
    .max(MAX_EMAIL_LENGTH, "Email must be 254 characters or less")
    .refine(
        (s) => s.toLowerCase().endsWith("@basischina.com"),
        "Please use a @basischina.com email",
    );

export const TeamName = z
    .string()
    .trim()
    .min(2, "Team name must be at least 2 characters")
    .max(30, "Team name cannot be longer than 30 characters");

export const ProjectName = z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(MAX_PROJECT_NAME_LENGTH, "Project name cannot be longer than 100 characters");

export const ProjectDescription = z
    .string()
    .trim()
    .min(30, "Please provide more details in the description")
    .max(MAX_PROJECT_DESCRIPTION_LENGTH, "Project description is too long");

export const ProjectUrl = z
    .union([z.url(), z.literal("")])
    .refine(
        (value) => value === "" || isSafeExternalProjectUrl(value),
        "URL must use http or https and must not contain credentials",
    )
    .refine(
        (v) => v === "" || v.length <= MAX_URL_LENGTH,
        "URL cannot be longer than 2048 characters",
    );

const RequiredProjectUrl = z
    .url("Invalid URL format")
    .refine(isSafeExternalProjectUrl, "URL must use http or https and must not contain credentials")
    .max(MAX_URL_LENGTH, "URL cannot be longer than 2048 characters");

function isSafeExternalProjectUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            Boolean(url.hostname) &&
            !url.username &&
            !url.password
        );
    } catch {
        return false;
    }
}

const TeamPathway = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
        /^[a-z0-9][a-z0-9_-]*$/,
        "Track must use lowercase letters, numbers, dashes, or underscores",
    );

export const BooleanString = z.enum(["true", "false"]).transform((s) => s === "true");

export const ZeroToFive = z.number().int().min(0).max(5);
export const ScoreValues = z.object(
    Object.keys(rubrics["junior"]).reduce(
        (obj, key) => ({
            ...obj,
            [key]: ZeroToFive,
        }),
        {} as Record<keyof (typeof rubrics)["junior"], typeof ZeroToFive>,
    ),
);

export const RubricCriterionSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500),
        weight: z.number().int().min(1).max(100),
        minScore: z.number().int().min(0).max(99),
        maxScore: z.number().int().min(1).max(100),
    })
    .refine((criterion) => criterion.maxScore > criterion.minScore, {
        message: "Maximum score must be higher than minimum score",
        path: ["maxScore"],
    });

export const RubricTrackSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        criteria: z.array(RubricCriterionSchema).min(1).max(20),
    })
    .refine(
        (track) =>
            new Set(track.criteria.map((criterion) => criterion.id)).size === track.criteria.length,
        {
            message: "Criterion IDs must be unique within a track",
            path: ["criteria"],
        },
    )
    .refine(
        (track) => track.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) === 100,
        {
            message: "Criterion weights must total 100 for each track",
            path: ["criteria"],
        },
    );

export const JudgeCommentGuidanceSchema = z.object({
    introduction: z.string().trim().min(1).max(300),
    guidelines: z.array(z.string().trim().min(1).max(240)).min(1).max(10),
    templates: z
        .array(
            z.object({
                label: z.string().trim().min(1).max(60),
                body: z.string().trim().min(1).max(1_000),
            }),
        )
        .min(1)
        .max(8)
        .refine(
            (templates) =>
                new Set(templates.map((template) => template.label.toLocaleLowerCase())).size ===
                templates.length,
            { message: "Comment template labels must be unique" },
        ),
});

export const RubricDefinitionSchema: z.ZodType<RubricDefinition> = z.object({
    tracks: z
        .record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), RubricTrackSchema)
        .refine((tracks) => Object.keys(tracks).length >= 1 && Object.keys(tracks).length <= 8, {
            message: "A rubric must contain between 1 and 8 tracks",
        }),
    commentGuidance: JudgeCommentGuidanceSchema.optional(),
});

const DynamicRubricScores = z.record(
    z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    z.number().int().min(0).max(100),
);

export const SaveJudgingDraftRequest = z.object({
    scores: DynamicRubricScores,
    reasoning: z.string().max(MAX_REASONING_LENGTH).default(""),
    rubric_version_id: z.number().int().positive().max(POSTGRES_INT_MAX),
});

export const SubmitTeamScoresRequest = z.object({
    scores: DynamicRubricScores,
    reasoning: z
        .string()
        .trim()
        .min(
            MIN_JUDGE_COMMENT_LENGTH,
            `Write at least ${MIN_JUDGE_COMMENT_LENGTH} characters of feedback.`,
        )
        .max(MAX_REASONING_LENGTH)
        .refine((value) => !hasUnfilledCommentTemplate(value), {
            message: "Replace the example text in the comment template before submitting.",
        }),
    rubric_version_id: z.number().int().positive().max(POSTGRES_INT_MAX),
});

export const CreateRubricVersionRequest = z
    .object({
        name: z.string().trim().min(1).max(100),
        definition: RubricDefinitionSchema.optional(),
        copyFromSeasonId: z.coerce.number().int().positive().max(POSTGRES_INT_MAX).optional(),
        sourceTemplateId: z.coerce.number().int().positive().max(POSTGRES_INT_MAX).optional(),
    })
    .refine(
        (request) =>
            Number(request.definition !== undefined) +
                Number(request.copyFromSeasonId !== undefined) +
                Number(request.sourceTemplateId !== undefined) ===
            1,
        { message: "Provide a rubric definition, prior season, or template" },
    );

export const CreateRubricTemplateRequest = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    definition: RubricDefinitionSchema,
});

/** PostgreSQL `integer` upper bound; larger IDs would otherwise reach the driver and 500. */
export const PositiveIntParam = z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX);
export const TeamIdParams = z.object({ id: PositiveIntParam });
export const TeamUserParams = z.object({ id: PositiveIntParam, user: PositiveIntParam });
export const UserIdParams = z.object({ id: PositiveIntParam });
export const JudgingHistoryParams = z.object({ seasonId: PositiveIntParam });
export const DeepSeekSessionIdParams = z.object({ id: PositiveIntParam });
export const ApplicationIdParams = z.object({
    id: z.string().min(1).max(MAX_CLIENT_ID_LENGTH, "Invalid client_id"),
});

export const GetTeamsQuery = z.object({
    judging: BooleanString.optional(),
    season_id: z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX).optional(),
    page: z.coerce.number().int().min(1).max(100_000).finite().optional(),
    page_size: z.coerce.number().int().min(1).max(50).finite().optional(),
});
export type GetTeamsQuery = z.infer<typeof GetTeamsQuery>;

export const CreateTeamRequest = z.object({
    name: TeamName,
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

export const UpdateTeamRequest = z.object({
    name: z.optional(TeamName),
    pathway: z.optional(TeamPathway),
    project: z.optional(
        z.object({
            name: z.optional(ProjectName),
            description: z.optional(
                z.string().max(MAX_PROJECT_DESCRIPTION_LENGTH, "Project description is too long"),
            ),
            demo_url: ProjectUrl.nullish().transform((v) => (v === "" ? null : v)),
            repo_url: ProjectUrl.nullish().transform((v) => (v === "" ? null : v)),
            video_url: ProjectUrl.nullish().transform((v) => (v === "" ? null : v)),
            sourcing: z.optional(
                z.string().max(MAX_PROJECT_SOURCE_LENGTH, "Sourcing notes are too long"),
            ),
        }),
    ),
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequest>;

export const SubmitTeamRequest = z.object({
    pathway: TeamPathway,
    project: z.object({
        name: ProjectName,
        description: ProjectDescription,
        demo_url: RequiredProjectUrl,
        repo_url: RequiredProjectUrl,
        video_url: RequiredProjectUrl,
        sourcing: z
            .string()
            .trim()
            .min(1, "AI-use disclosure is required")
            .max(MAX_PROJECT_SOURCE_LENGTH, "Sourcing notes are too long"),
    }),
});
export type SubmitTeamRequest = z.infer<typeof SubmitTeamRequest>;

export const AddTeamMemberRequest = z.object({
    email: BasisEmail,
    /** Allow an invitation to an email without an account yet. Defaults to false. */
    allowUnclaimed: z.boolean().optional(),
});
export type AddTeamMemberRequest = z.infer<typeof AddTeamMemberRequest>;

/** Teams are capped so a single project cannot absorb the whole event. */
export const MAX_TEAM_MEMBERS = 6;
export const MAX_TEAM_MEMBERS_LIMIT = 20;
export const TeamMemberLimit = z.number().int().min(1).max(MAX_TEAM_MEMBERS_LIMIT);

export const TransferTeamOwnerRequest = z.object({
    user_id: PositiveIntParam,
});
export type TransferTeamOwnerRequest = z.infer<typeof TransferTeamOwnerRequest>;

export const JudgeFlagRequest = z.object({
    team_id: PositiveIntParam,
    reason: z.string().trim().min(5, "Explain the conflict").max(1000),
});
export type JudgeFlagRequest = z.infer<typeof JudgeFlagRequest>;

export const JudgeFlagIdParams = z.object({ id: PositiveIntParam });

export const AdminJudgeFlagQuery = z.object({
    season_id: z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX).optional(),
    resolved: BooleanString.optional(),
});
export type AdminJudgeFlagQuery = z.infer<typeof AdminJudgeFlagQuery>;

export const TeamInviteTokenParams = z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid invitation token"),
});

export const TeamInviteParams = z.object({
    id: PositiveIntParam,
    invite: PositiveIntParam,
});
export type TeamInviteParams = z.infer<typeof TeamInviteParams>;

export const TeamInviteIdParams = z.object({ id: PositiveIntParam });
export type TeamInviteIdParams = z.infer<typeof TeamInviteIdParams>;

export const MAX_PROFILE_IMAGE_BYTES = 7 * 1024 * 1024; // Base64 JSON fits the app's 10 MiB profile body cap.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

export const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

export const UpdateUserRequest = z.object({
    name: z.optional(z.string().trim().max(MAX_USER_NAME_LENGTH, "Name is too long")),
    profile_theme_image: z
        .union([
            z
                .instanceof(File)
                .refine(
                    (file) => file.size <= MAX_PROFILE_IMAGE_BYTES,
                    `The image is too large. Please choose an image smaller than ${formatBytes(MAX_PROFILE_IMAGE_BYTES)}.`,
                )
                .refine(
                    (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
                    "Please upload a valid image file (JPEG, PNG, GIF, or WebP)",
                ),
            z.string().startsWith("data"),
            z.null(),
        ])
        .optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const CreateTeamScoresRequest = z.object({
    reasoning: z
        .string()
        .min(10, "Please write more")
        .max(MAX_REASONING_LENGTH, "Reasoning is too long"),
    scores: ScoreValues,
});
export type CreateTeamScoresRequest = z.infer<typeof CreateTeamScoresRequest>;

export const SubmitVoteRequest = z
    .object({
        scores: z
            .array(z.number().int().min(0).max(5))
            .max(MAX_VOTE_SCORES, "Too many scores submitted"),
        reasoning: z.string().max(MAX_REASONING_LENGTH, "You wrote too much!"),
    })
    .refine(({ scores }) => scores.reduce((a, b) => a + b, 0) === 10, "Stars must sum to 10");
export type SubmitVoteRequest = z.infer<typeof SubmitVoteRequest>;

export const DeleteApplicationsRequest = z.object({
    ids: z
        .array(z.string().min(1))
        .max(
            MAX_BULK_DELETE_IDS,
            `Cannot delete more than ${MAX_BULK_DELETE_IDS} applications at once`,
        ),
});
export type DeleteApplicationsRequest = z.infer<typeof DeleteApplicationsRequest>;

export const ManageRedirectUriRequest = z.object({
    uri: z
        .string()
        .min(1, "Redirect URI is required")
        .url("Invalid URL format")
        .refine(
            (u) => {
                const parsed = new URL(u);
                if (parsed.username || parsed.password) return false;
                if (parsed.protocol === "https:") return true;
                return (
                    parsed.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
                );
            },
            { message: "Redirect URI must use https:// or http://localhost" },
        ),
});
export type ManageRedirectUriRequest = z.infer<typeof ManageRedirectUriRequest>;

export const OAuth2TokenRequest = z.object({
    grant_type: z.literal("authorization_code", {
        message: "Only 'authorization_code' grant type is supported",
    }),
    code: z
        .string("Authorization code is required")
        .min(1, "Authorization code is required")
        .max(MAX_OAUTH2_CODE_LENGTH, "Authorization code is too long"),
    client_id: z
        .string("client_id is required")
        .min(1, "client_id is required")
        .max(MAX_CLIENT_ID_LENGTH, "client_id is too long"),
    client_secret: z
        .string("client_secret is required")
        .min(1, "client_secret is required")
        .max(MAX_CLIENT_SECRET_LENGTH, "client_secret is too long"),
    redirect_uri: z
        .string()
        .max(MAX_REDIRECT_URI_LENGTH, "redirect_uri is too long")
        .optional()
        .or(z.literal("")),
    code_verifier: z.string().max(MAX_CODE_VERIFIER_LENGTH, "code_verifier is too long").optional(),
});
export type OAuth2TokenRequest = z.infer<typeof OAuth2TokenRequest>;
export const OAuth2SessionActionRequest = z.object({
    action: z.enum(
        ["cancel", "consent", "assume_consent", "deny"],
        "Actions must be one of 'cancel', 'consent', 'assume_consent', or 'deny'",
    ),
});
export type OAuth2SessionActionRequest = z.infer<typeof OAuth2SessionActionRequest>;

export const SetActiveSeasonRequest = z.object({
    season_id: z.number().int().positive().max(POSTGRES_INT_MAX).nullable(),
});
export type SetActiveSeasonRequest = z.infer<typeof SetActiveSeasonRequest>;

export const UpdateSeasonTweaksRequest = z
    .object({
        status: z.enum(["not_started", "in_progress", "voting", "finished", "paused"]).optional(),
        show_scores: z.boolean().optional(),
        show_ranking: z.boolean().optional(),
    })
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
        message: "At least one field must be provided",
    });
export type UpdateSeasonTweaksRequest = z.infer<typeof UpdateSeasonTweaksRequest>;

export const ElectionVoteRequest = z.object({
    positions: z
        .array(
            z.object({
                title: z.string().max(MAX_ELECTION_TITLE_LENGTH, "Position title is too long"),
                candidates: z
                    .array(
                        z.object({
                            id: z
                                .string()
                                .max(MAX_ELECTION_CANDIDATE_ID_LENGTH, "Candidate ID is too long"),
                            rank: z.number().int().min(1).nullable(),
                        }),
                    )
                    .max(MAX_ELECTION_CANDIDATES, "Too many candidates"),
            }),
        )
        .max(MAX_ELECTION_POSITIONS, "Too many positions"),
});
export type ElectionVoteRequest = z.infer<typeof ElectionVoteRequest>;

// ---------------------------------------------------------------------------
// Admin – hackathon configuration
// ---------------------------------------------------------------------------

export const HackathonStatusEnum = z.enum([
    "not_started",
    "in_progress",
    "voting",
    "finished",
    "paused",
]);

export const AdminUpdateHackathonRequest = z.object({
    season_id: z.number().int().positive().max(POSTGRES_INT_MAX).optional(),
    status: HackathonStatusEnum.optional(),
    voting_enabled: z.union([z.literal(0), z.literal(1)]).optional(),
    results_published: z.union([z.literal(0), z.literal(1)]).optional(),
    judging_open: z.union([z.literal(0), z.literal(1)]).optional(),
    show_scores: z.union([z.literal(0), z.literal(1)]).optional(),
    show_ranking: z.union([z.literal(0), z.literal(1)]).optional(),
    max_votes_per_user: z.number().int().min(0).max(100).optional(),
    schedule_start: z.string().max(100).nullable().optional(),
    schedule_end: z.string().max(100).nullable().optional(),
    start_timestamp: z
        .number()
        .int()
        .nonnegative()
        .max(8_640_000_000_000_000)
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    end_timestamp: z
        .number()
        .int()
        .nonnegative()
        .max(8_640_000_000_000_000)
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    voting_start_timestamp: z
        .number()
        .int()
        .nonnegative()
        .max(8_640_000_000_000_000)
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    voting_end_timestamp: z
        .number()
        .int()
        .nonnegative()
        .max(8_640_000_000_000_000)
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    results_open_timestamp: z
        .number()
        .int()
        .nonnegative()
        .max(8_640_000_000_000_000)
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    theme_name: z.string().max(200).nullable().optional(),
    theme_description: z.string().max(2000).nullable().optional(),
    announcement: z.string().max(2000).nullable().optional(),
});
export type AdminUpdateHackathonRequest = z.infer<typeof AdminUpdateHackathonRequest>;

/** Editable live settings the portal keeps in PostgreSQL on top of HACKATHON.yml. */
export const LIVE_OVERRIDE_KEYS = [
    "status",
    "voting_enabled",
    "results_published",
    "judging_open",
    "show_scores",
    "show_ranking",
    "max_votes_per_user",
    "schedule_start",
    "schedule_end",
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
    "theme_name",
    "theme_description",
    "announcement",
] as const;

export const LiveOverrides = AdminUpdateHackathonRequest.pick({
    status: true,
    voting_enabled: true,
    results_published: true,
    judging_open: true,
    show_scores: true,
    show_ranking: true,
    max_votes_per_user: true,
    schedule_start: true,
    schedule_end: true,
    start_timestamp: true,
    end_timestamp: true,
    voting_start_timestamp: true,
    voting_end_timestamp: true,
    results_open_timestamp: true,
    theme_name: true,
    theme_description: true,
    announcement: true,
});
export type LiveOverrides = z.infer<typeof LiveOverrides>;

// ---------------------------------------------------------------------------
// Admin – season management
// ---------------------------------------------------------------------------

export const CreateSeasonRequest = z.object({
    name: z.string().trim().min(1).max(200),
    is_active: z
        .union([z.literal(0), z.literal(1)])
        .optional()
        .default(0),
    copy_live_settings: z.boolean().optional().default(true),
});
export type CreateSeasonRequest = z.infer<typeof CreateSeasonRequest>;

export const UpdateSeasonRequest = z.object({
    id: z.number().int().positive().max(POSTGRES_INT_MAX),
    name: z.string().trim().min(1).max(200).optional(),
    is_active: z.union([z.literal(0), z.literal(1)]).optional(),
    max_team_members: TeamMemberLimit.optional(),
});
export type UpdateSeasonRequest = z.infer<typeof UpdateSeasonRequest>;

export const UpdateSeasonApprovalRequest = z.object({ approved: z.boolean() });
export type UpdateSeasonApprovalRequest = z.infer<typeof UpdateSeasonApprovalRequest>;

// ---------------------------------------------------------------------------
// Operational admin and event-staff contracts
// ---------------------------------------------------------------------------

export const TeamStatusEnum = z.enum(["active", "withdrawn", "disqualified", "no_show"]);

export const AdminTeamStatusRequest = z.object({
    status: TeamStatusEnum,
    reason: z.string().max(500).optional(),
});
export type AdminTeamStatusRequest = z.infer<typeof AdminTeamStatusRequest>;

export const AdminTeamReopenRequest = z.object({
    reason: z.string().max(500).optional(),
});
export type AdminTeamReopenRequest = z.infer<typeof AdminTeamReopenRequest>;

export const AdminTeamScoreParams = z.object({
    id: PositiveIntParam,
    judgeId: PositiveIntParam,
});
export type AdminTeamScoreParams = z.infer<typeof AdminTeamScoreParams>;

const AwardNamespace = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
        /^[a-z0-9][a-z0-9_-]*$/,
        "Award namespace must be lowercase letters, numbers, dashes, or underscores",
    );

export const CreateAwardRequest = z.object({
    namespace: AwardNamespace,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    icon: z.string().trim().min(1).max(100),
    color: z.string().trim().min(1).max(32).default("gold"),
});
export type CreateAwardRequest = z.infer<typeof CreateAwardRequest>;

export const AwardNamespaceParams = z.object({ namespace: AwardNamespace });
export type AwardNamespaceParams = z.infer<typeof AwardNamespaceParams>;

export const CreateTeamAwardRequest = z.object({
    award: AwardNamespace,
    meta: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTeamAwardRequest = z.infer<typeof CreateTeamAwardRequest>;

export const TeamAwardParams = z.object({ id: PositiveIntParam, award: AwardNamespace });
export type TeamAwardParams = z.infer<typeof TeamAwardParams>;

export const JudgeAssignmentRequest = z
    .object({
        season_id: z.number().int().positive().max(POSTGRES_INT_MAX).optional(),
        judge_user_id: PositiveIntParam,
        pathway: z.string().trim().min(1).max(64).nullable().optional(),
        team_id: PositiveIntParam.nullable().optional(),
    })
    .refine((value) => !(value.pathway && value.team_id), {
        message: "Assign a judge to a pathway or a team, not both",
    });
export type JudgeAssignmentRequest = z.infer<typeof JudgeAssignmentRequest>;

export const JudgeAssignmentQuery = z.object({
    season_id: z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX).optional(),
    id: PositiveIntParam.optional(),
});
export type JudgeAssignmentQuery = z.infer<typeof JudgeAssignmentQuery>;

export const JudgeRecusalRequest = z.object({
    season_id: z.number().int().positive().max(POSTGRES_INT_MAX).optional(),
    team_id: PositiveIntParam,
    reason: z.string().trim().max(500).optional(),
});
export type JudgeRecusalRequest = z.infer<typeof JudgeRecusalRequest>;

export const AdminAuditQuery = z.object({
    season_id: z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminSeasonQuery = z.object({
    season_id: z.coerce.number().int().positive().finite().max(POSTGRES_INT_MAX).optional(),
});
export type AdminSeasonQuery = z.infer<typeof AdminSeasonQuery>;

export const NotificationsQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;

export const NotificationIdParams = z.object({ id: PositiveIntParam });
export type NotificationIdParams = z.infer<typeof NotificationIdParams>;
