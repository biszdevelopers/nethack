export const MIN_JUDGE_COMMENT_LENGTH = 20;

export interface JudgeCommentTemplate {
    label: string;
    body: string;
}

export interface JudgeCommentGuidance {
    introduction: string;
    guidelines: string[];
    templates: JudgeCommentTemplate[];
}

export const DEFAULT_JUDGE_COMMENT_GUIDANCE: JudgeCommentGuidance = {
    introduction: "Make feedback specific, respectful, and focused on the project.",
    guidelines: [
        "Describe a strength you observed and one actionable next step.",
        "Comment on the work, not the people or their background.",
        "Do not include your name or details that could identify you.",
        "Replace every double-braced example with your own observation.",
    ],
    templates: [
        {
            label: "Strength + next step",
            body: "Strength I observed: {{describe a specific feature or decision}}\nNext step: {{suggest one concrete action and why it matters}}",
        },
        {
            label: "What stood out",
            body: "What stood out: {{describe a specific moment, feature, or result}}\nTo make it stronger: {{suggest one practical improvement}}",
        },
        {
            label: "Technical feedback",
            body: "Implementation strength: {{name a technical choice and its effect}}\nArea to explore next: {{suggest a useful test or refinement}}",
        },
    ],
};

export function resolveJudgeCommentGuidance(
    guidance: JudgeCommentGuidance | null | undefined,
): JudgeCommentGuidance {
    return guidance ?? DEFAULT_JUDGE_COMMENT_GUIDANCE;
}

const UNFILLED_COMMENT_TEMPLATE = /\{\{[^{}]+\}\}/;

export function hasUnfilledCommentTemplate(value: string): boolean {
    return UNFILLED_COMMENT_TEMPLATE.test(value);
}

export function isJudgeCommentReady(value: string): boolean {
    const comment = value.trim();
    return comment.length >= MIN_JUDGE_COMMENT_LENGTH && !hasUnfilledCommentTemplate(comment);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Conservatively flags the judge's exact email address or display name in a comment.
 * This does not detect indirect identity clues or alternate spellings.
 */
export function commentContainsJudgeIdentity(
    comment: string,
    email: string | null | undefined,
    displayName: string | null | undefined,
): boolean {
    const normalizedComment = comment.trim();
    if (!normalizedComment) return false;

    if (email?.trim()) {
        const escapedEmail = escapeRegExp(email.trim());
        const emailPattern = new RegExp(
            `(?:^|[^\\p{L}\\p{N}._%+-])${escapedEmail}(?:$|[^\\p{L}\\p{N}._%+-])`,
            "iu",
        );
        if (emailPattern.test(normalizedComment)) return true;
    }

    const name = displayName?.trim().replace(/\s+/g, " ");
    if (!name) return false;

    const escapedName = name.split(" ").map(escapeRegExp).join("\\s+");
    const namePattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${escapedName}(?:$|[^\\p{L}\\p{N}])`,
        "iu",
    );
    return namePattern.test(normalizedComment);
}

export const JUDGE_COMMENT_IDENTITY_ERROR =
    "Remove your email address or display name from the comment to keep it anonymous.";
