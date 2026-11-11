export interface RubricData {
    abbr: string;
    name: string;
    description: string;
    weight: number;
}

export interface RubricBallot {
    originality: RubricData;
    presentation: RubricData;
    technicality: RubricData;
    theme: RubricData;
    impact: RubricData;
}

export interface RubricCriterion {
    id: string;
    name: string;
    description: string;
    weight: number;
    minScore: number;
    maxScore: number;
}

export interface RubricTrack {
    name: string;
    criteria: RubricCriterion[];
}

export interface RubricDefinition {
    tracks: Record<string, RubricTrack>;
}

export interface RubricScoreValidationOptions {
    allowPartial?: boolean;
}

export function validateRubricScores(
    track: RubricTrack,
    scores: Record<string, number>,
    options: RubricScoreValidationOptions = {},
): string[] {
    const issues: string[] = [];
    const criteria = new Map(track.criteria.map((criterion) => [criterion.id, criterion]));

    for (const [id, score] of Object.entries(scores)) {
        const criterion = criteria.get(id);
        if (!criterion) {
            issues.push(`Unknown criterion: ${id}`);
            continue;
        }
        if (!Number.isInteger(score) || score < criterion.minScore || score > criterion.maxScore) {
            issues.push(
                `${criterion.name} must be an integer from ${criterion.minScore} to ${criterion.maxScore}.`,
            );
        }
    }

    if (!options.allowPartial) {
        for (const criterion of track.criteria) {
            if (!Object.hasOwn(scores, criterion.id)) {
                issues.push(`Missing score for ${criterion.name}.`);
            }
        }
    }

    return issues;
}

const rubrics = {
    junior: {
        originality: {
            abbr: "ORG",
            name: "Innovation & Originality",
            description: "Novelty of idea and approach.",
            weight: 30,
        },
        presentation: {
            abbr: "PRE",
            name: "Presentation & Design",
            description: "Clarity, polish, and design of demo.",
            weight: 25,
        },
        technicality: {
            abbr: "TEC",
            name: "Technical Complexity",
            description: "Depth and quality of technical implementation.",
            weight: 20,
        },
        theme: {
            abbr: "THM",
            name: "Theme Alignment",
            description: "How clearly the project relates to the theme.",
            weight: 15,
        },
        impact: {
            abbr: "IMP",
            name: "Impact & Usefulness",
            description: "Potential to solve real problems or benefit users.",
            weight: 10,
        },
    },
    senior: {
        impact: {
            abbr: "IMP",
            name: "Impact & Usefulness",
            description: "Potential to solve real problems or benefit users.",
            weight: 30,
        },
        presentation: {
            abbr: "PRE",
            name: "Presentation & Design",
            description: "Clarity, polish, and design of demo.",
            weight: 25,
        },
        technicality: {
            abbr: "TEC",
            name: "Technical Complexity",
            description: "Depth and quality of technical implementation.",
            weight: 20,
        },
        theme: {
            abbr: "THM",
            name: "Theme Alignment",
            description: "How clearly the project relates to the theme.",
            weight: 15,
        },
        originality: {
            abbr: "ORG",
            name: "Innovation & Originality",
            description: "Novelty of idea and approach.",
            weight: 10,
        },
    },
} satisfies {
    junior: RubricBallot;
    senior: RubricBallot;
};

const toCriterion = (id: string, item: RubricData): RubricCriterion => ({
    id,
    name: item.name,
    description: item.description,
    weight: item.weight,
    minScore: 0,
    maxScore: 5,
});

export const DEFAULT_RUBRIC_DEFINITION: RubricDefinition = {
    tracks: {
        junior: {
            name: "Junior",
            criteria: Object.entries(rubrics.junior).map(([id, item]) => toCriterion(id, item)),
        },
        senior: {
            name: "Senior",
            criteria: Object.entries(rubrics.senior).map(([id, item]) => toCriterion(id, item)),
        },
    },
};

/** Normalize any configured integer score scale to the existing 0–100 result range. */
export function calculateWeightedRubricScore(
    track: RubricTrack,
    scores: Record<string, number>,
): number {
    const weightedScore = track.criteria.reduce((total, criterion) => {
        const score = scores[criterion.id] ?? criterion.minScore;
        const range = criterion.maxScore - criterion.minScore;
        const normalized = range > 0 ? (score - criterion.minScore) / range : 0;
        return total + normalized * criterion.weight;
    }, 0);

    // Keep precision while combining judges. The team-level average is rounded
    // once after every normalized weighted score has been included.
    return Math.round(weightedScore * 1_000_000) / 1_000_000;
}

export default rubrics;
