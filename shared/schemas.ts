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
export const MAX_VOTE_SCORES = 50;
export const MAX_ELECTION_POSITIONS = 20;
export const MAX_ELECTION_CANDIDATES = 50;
export const MAX_ELECTION_TITLE_LENGTH = 128;
export const MAX_ELECTION_CANDIDATE_ID_LENGTH = 64;
export const MAX_APPLICATION_IDS_DELETE = 100;

export const BasisEmail = z
    .email()
    .max(MAX_EMAIL_LENGTH, "Email must be 254 characters or less")
    .refine(
        (s) => s.toLowerCase().endsWith("@basischina.com"),
        "Please use a @basischina.com email",
    );

export const TeamName = z
    .string()
    .min(2, "Team name must be at least 2 characters")
    .max(30, "Team name cannot be longer than 30 characters");

export const ProjectName = z
    .string()
    .min(1, "Project name is required")
    .max(MAX_PROJECT_NAME_LENGTH, "Project name cannot be longer than 100 characters");

export const ProjectDescription = z
    .string()
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

export const RubricDefinitionSchema: z.ZodType<RubricDefinition> = z.object({
    tracks: z
        .record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), RubricTrackSchema)
        .refine((tracks) => Object.keys(tracks).length >= 1 && Object.keys(tracks).length <= 8, {
            message: "A rubric must contain between 1 and 8 tracks",
        }),
});

const DynamicRubricScores = z.record(
    z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    z.number().int().min(0).max(100),
);

export const SaveJudgingDraftRequest = z.object({
    scores: DynamicRubricScores,
    reasoning: z.string().max(MAX_REASONING_LENGTH).default(""),
    rubric_version_id: z.number().int().positive(),
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
    rubric_version_id: z.number().int().positive(),
});

export const CreateRubricVersionRequest = z
    .object({
        name: z.string().trim().min(1).max(100),
        definition: RubricDefinitionSchema.optional(),
        copyFromSeasonId: z.coerce.number().int().positive().optional(),
        sourceTemplateId: z.coerce.number().int().positive().optional(),
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

export const PositiveIntParam = z.coerce.number().int().positive().finite();
export const TeamIdParams = z.object({ id: PositiveIntParam });
export const TeamUserParams = z.object({ id: PositiveIntParam, user: PositiveIntParam });
export const UserIdParams = z.object({ id: PositiveIntParam });
export const DeepSeekSessionIdParams = z.object({ id: PositiveIntParam });
export const ApplicationIdParams = z.object({
    id: z.string().min(1).max(MAX_CLIENT_ID_LENGTH, "Invalid client_id"),
});

export const CreateTeamQuery = z.object({
    add: BooleanString.optional(),
});
export type CreateTeamQuery = z.infer<typeof CreateTeamQuery>;

export const GetTeamsQuery = z.object({
    judging: BooleanString.optional(),
    season_id: z.coerce.number().int().positive().finite().optional(),
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
        sourcing: z.optional(
            z.string().max(MAX_PROJECT_SOURCE_LENGTH, "Sourcing notes are too long"),
        ),
    }),
});
export type SubmitTeamRequest = z.infer<typeof SubmitTeamRequest>;

export const AddTeamMemberRequest = z.object({
    email: BasisEmail,
});
export type AddTeamMemberRequest = z.infer<typeof AddTeamMemberRequest>;

export const MAX_PROFILE_IMAGE_BYTES = 7 * 1024 * 1024; // Base64 JSON fits the app's 10 MiB profile body cap.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

export const UpdateUserRequest = z.object({
    name: z.optional(z.string().max(MAX_USER_NAME_LENGTH, "Name is too long")),
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
                    "Please upload a valid image file (JPEG, PNG, or WebP)",
                ),
            z.string().startsWith("data"),
            z.null(),
        ])
        .optional(),
    avatar: z
        .union([
            z
                .instanceof(File)
                .refine(
                    (file) => file.size <= MAX_PROFILE_IMAGE_BYTES,
                    `The image is too large. Please choose an image smaller than ${formatBytes(MAX_PROFILE_IMAGE_BYTES)}.`,
                )
                .refine(
                    (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
                    "Please upload a valid image file (JPEG, PNG, or WebP)",
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
            MAX_APPLICATION_IDS_DELETE,
            `Cannot delete more than ${MAX_APPLICATION_IDS_DELETE} applications at once`,
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
                if (u.startsWith("https://")) return true;
                return /^http:\/\/localhost(\/|:|$)/.test(u);
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
    season_id: z.number().int().positive().nullable(),
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
    season_id: z.number().int().positive().optional(),
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
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    end_timestamp: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    voting_start_timestamp: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    voting_end_timestamp: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    results_open_timestamp: z
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? 0)
        .optional(),
    theme_name: z.string().max(200).nullable().optional(),
    theme_description: z.string().max(2000).nullable().optional(),
});
export type AdminUpdateHackathonRequest = z.infer<typeof AdminUpdateHackathonRequest>;

// ---------------------------------------------------------------------------
// Admin – season management
// ---------------------------------------------------------------------------

export const CreateSeasonRequest = z.object({
    name: z.string().min(1).max(200),
    is_active: z
        .union([z.literal(0), z.literal(1)])
        .optional()
        .default(0),
});
export type CreateSeasonRequest = z.infer<typeof CreateSeasonRequest>;

export const UpdateSeasonRequest = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    is_active: z.union([z.literal(0), z.literal(1)]).optional(),
});
export type UpdateSeasonRequest = z.infer<typeof UpdateSeasonRequest>;
