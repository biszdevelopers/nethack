interface ProfileTheme {
    mode: "url" | "emoji" | "gradient";
    value: string;
}

interface APIAward {
    namespace: string;
    name: string;
    description: string;
    icon: string;
    meta: Record<string, unknown>;
    color: string;
    text: string;
}

interface APIUser {
    id: number;
    email?: string;
    name: string | null;
    team_id?: number | null;
    profile_theme: ProfileTheme | null;
    profile_picture: string | null;
}

interface APITeam {
    id: number;
    name: string;
    pathway: TeamPathway | null;
    rank?: number | null;
    score?: number | null;
    season_id: number;
    status?: TeamStatus;
    owner_user_id?: number | null;
    project: {
        name: string;
        description: string;
        demo_url: string | null;
        repo_url: string | null;
        video_url: string | null;
        submitted: boolean;
        sourcing: string;
    };
    awards: APIAward[];
}

interface JudgeQueueEvaluation {
    scores: Record<string, number>;
    reasoning: string;
}

interface JudgeQueueItem {
    team: APITeam;
    evaluated: boolean;
    evaluation: JudgeQueueEvaluation | null;
}

interface GetJudgingQueueResponse {
    items: JudgeQueueItem[];
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
}

interface JudgingHistoryItem {
    team: APITeam;
    rubric_name: string;
    rubric_version: number;
    track_name: string;
    normalized_score: number | null;
    scores: Record<string, number>;
    criteria: ScoreFeedbackCriterionResponse[];
    reasoning: string;
    unavailable?: boolean;
}

interface GetJudgingHistoryResponse {
    season: { id: number; name: string };
    items: JudgingHistoryItem[];
    unavailable_evaluations: number;
}

interface GetUserResponse extends APIUser {
    team: APITeam | null;
    past_teams: APITeam[];
}

type GetTeamResponse = APITeam;

interface ScoreFeedbackCriterionResponse {
    id: string;
    name: string;
    description?: string;
    weight?: number;
    minScore: number;
    maxScore: number;
}

interface ScoreFeedbackEntryResponse {
    reasoning: string;
    rubric_name?: string;
    rubric_version?: number;
    track_name?: string;
    normalized_score?: number;
    scores?: Record<string, number>;
    criteria?: ScoreFeedbackCriterionResponse[];
    judge_id?: number;
    judge_name?: string | null;
    created_at?: string | null;
}

interface TeamScoreFeedbackResponse {
    team_id: number;
    season_id: number;
    original_score: number | null;
    displayed_score: number | null;
    curve_preset: import("./score-curve").ScoreCurvePreset | null;
    curve_label: string | null;
    rank: number | null;
    project: {
        name: string;
        description: string;
        demo_url: string | null;
        repo_url: string | null;
        video_url: string | null;
        sourcing: string;
    };
    feedback_withheld_for_anonymity?: boolean;
    /** Evaluations skipped because their saved rubric or scores could not be read. */
    unavailable_evaluations: number;
    feedback: ScoreFeedbackEntryResponse[];
}

interface PublicSeason {
    id: number;
    name: string;
    is_active: number;
    status: string;
    results_published: number;
    start_timestamp: number;
    end_timestamp: number;
    voting_start_timestamp: number;
    voting_end_timestamp: number;
    results_open_timestamp: number;
    theme_name: string | null;
    theme_description: string | null;
    is_submission_closed?: boolean;
    is_gallery_public?: boolean;
    is_judging_open?: boolean;
    is_voting_open?: boolean;
    max_team_members?: number;
}

interface BoardApprovalResponse {
    id: number;
    board_approved_at: Date | null;
    board_approved_by: number | null;
}

type CreateTeamResponse = APITeam;

type GetTeamMembersResponse = {
    id: number;
    email: string;
    name: string | null;
    team_id: number | null;
}[];

interface TeamInviteResponse {
    id: number;
    email: string;
    expires_at: string | null;
}

type GetTeamInvitesResponse = {
    invites: TeamInviteResponse[];
    max_team_members: number;
};

interface CreateTeamInviteResponse {
    id: number;
    email: string;
    token: string;
    expires_at: string;
    invite_url: string;
    message: string;
}

interface UserTeamInviteResponse {
    id: number;
    team_id: number;
    team_name: string;
}

type GetUserInvitesResponse = {
    invites: UserTeamInviteResponse[];
};

interface UpdateUserResponse {
    message: string;
}

interface GetBallotResponse {
    submitted: boolean;
    projects: APITeam[];
    scores: number[];
    reasoning: string | null;
    /** Maximum projects that may receive stars; zero means no cap. */
    max_votes_per_user: number;
}

interface BallotSummaryItem {
    season_id: number;
    season_name: string;
    project_count: number;
    submitted_count: number;
    scored_count: number;
}

type GetBallotSummaryResponse = {
    current: BallotSummaryItem | null;
    past: BallotSummaryItem[];
};

interface ElectionCandidate {
    id: string;
    shortName: string;
    fullName: string;
    email: string;
}

interface ElectionPosition {
    title: string;
    candidates: ElectionCandidate[];
}

interface ElectionResult {
    totalBallots: number;
    positions: {
        title: string;
        status: "elected" | "tie" | "no_votes";
        winner?: string;
        details?: string;
    }[];
}

interface ElectionBallot {
    id: number;
    user_id: number;
    name: string | null;
    email: string | null;
    submitted_at: number | null;
    vote: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Operational admin, notifications, awards, assignments, and peer-vote results
// ---------------------------------------------------------------------------

interface AdminStandingRow {
    team_id: number;
    name: string;
    pathway: TeamPathway | null;
    status: TeamStatus;
    score_exact: number;
    score: number;
    rank: number | null;
    awards: string[];
    project_name: string;
    project_demo_url: string | null;
    project_repo_url: string | null;
}

interface AdminStandingsResponse {
    season_id: number;
    generated_at: string;
    standings: AdminStandingRow[];
}

interface AdminPreflightResponse {
    season_id: number;
    submitted_teams: number;
    teams_below_minimum_evaluations: number;
    evaluations_total: number;
    judges_with_evaluations: number;
    assigned_judges: number;
    mismatches: {
        finished_without_results: number;
        published_without_timestamp: number;
        missing_event_end: number;
        invalid_date_range: number;
    };
    vote_cap: {
        max_votes_per_user: number;
        max_eligible_projects: number;
        feasible: boolean;
    };
    gates: {
        submissions_open: boolean;
        voting_open: boolean;
        judging_open: boolean;
        gallery_public: boolean;
        results_visible: boolean;
    };
}

interface AdminAuditEventResponse {
    id: number;
    actor_user_id: number | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string | null;
    request_id: string | null;
    created_at: string;
}

interface GetAdminAuditResponse {
    events: AdminAuditEventResponse[];
}

interface NotificationResponse {
    id: number;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: string | null;
    created_at: string;
}

interface GetNotificationsResponse {
    notifications: NotificationResponse[];
    unread: number;
}

interface JudgeAssignmentResponse {
    id: number;
    season_id: number;
    judge_user_id: number;
    pathway: string | null;
    team_id: number | null;
    created_at: string;
    judge_email?: string;
    judge_name?: string | null;
}

interface GetJudgeAssignmentsResponse {
    assignments: JudgeAssignmentResponse[];
}

interface JudgeFlagResponse {
    id: number;
    season_id: number;
    team_id: number;
    team_name: string;
    judge_user_id: number;
    judge_email?: string;
    judge_name?: string | null;
    reason: string;
    resolved_at: string | null;
    resolved_by: number | null;
    created_at: string;
}

interface GetJudgeFlagsResponse {
    flags: JudgeFlagResponse[];
}

interface GetJudgingCalibrationResponse {
    season_id: number;
    evaluations: number;
    overall_average: number | null;
    standard_deviation: number;
    judges: Array<{
        judge_user_id: number;
        name: string | null;
        email: string | null;
        evaluations: number;
        average: number;
        deviation: number;
        outlier: boolean;
    }>;
    outliers: GetJudgingCalibrationResponse["judges"];
}

interface BallotResultsProject {
    team_id: number;
    name: string;
    pathway: TeamPathway | null;
    average_stars: number | null;
    team_units: number;
}

interface BallotResultsResponse {
    season_id: number;
    results_visible: boolean;
    voting_closed: boolean;
    turnout: {
        submitted_teams: number;
        voting_teams: number;
        ballots: number;
        turnout_ratio: number;
    };
    projects: BallotResultsProject[];
}
