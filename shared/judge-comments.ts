export const MIN_JUDGE_COMMENT_LENGTH = 20;

const UNFILLED_COMMENT_TEMPLATE = /\{\{[^{}]+\}\}/;

export function hasUnfilledCommentTemplate(value: string): boolean {
    return UNFILLED_COMMENT_TEMPLATE.test(value);
}

export function isJudgeCommentReady(value: string): boolean {
    const comment = value.trim();
    return comment.length >= MIN_JUDGE_COMMENT_LENGTH && !hasUnfilledCommentTemplate(comment);
}
