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
    project: {
        name: string;
        description: string;
        demo_url: string | null;
        repo_url: string | null;
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

interface GetUserResponse extends APIUser {
    team: APITeam | null;
    past_teams: APITeam[];
}

interface GetTeamResponse extends APITeam {}

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
}

interface TeamScoreFeedbackResponse {
    team_id: number;
    season_id: number;
    original_score: number | null;
    displayed_score: number | null;
    curve_preset: import("./score-curve").ScoreCurvePreset | null;
    curve_label: string | null;
    rank: number | null;
    feedback_withheld_for_anonymity?: boolean;
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
}

type CreateTeamResponse = APITeam;

type GetTeamMembersResponse = {
    id: number;
    email: string;
    name: string | null;
    team_id: number | null;
}[];

interface UpdateUserResponse {
    message: string;
}

interface GetBallotResponse {
    submitted: boolean;
    projects: APITeam[];
    scores: number[];
    reasoning: string | null;
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
