import { describe, expect, it } from "vitest";
import {
    DEFAULT_JUDGE_COMMENT_GUIDANCE,
    commentContainsJudgeIdentity,
    isJudgeCommentReady,
} from "../../shared/judge-comments";
import {
    JudgeCommentGuidanceSchema,
    RubricDefinitionSchema,
    SubmitTeamScoresRequest,
} from "../../shared/schemas";
import { DEFAULT_RUBRIC_DEFINITION, withDefaultRubricCommentGuidance } from "../../shared/rubric";

describe("judge comment templates", () => {
    it("keeps default guidance available for older rubric versions", () => {
        const legacyDefinition = { tracks: DEFAULT_RUBRIC_DEFINITION.tracks };
        const resolved = withDefaultRubricCommentGuidance(legacyDefinition);

        expect(resolved.commentGuidance).toEqual(DEFAULT_JUDGE_COMMENT_GUIDANCE);
        expect(withDefaultRubricCommentGuidance(DEFAULT_RUBRIC_DEFINITION)).toEqual(
            DEFAULT_RUBRIC_DEFINITION,
        );
    });

    it("validates versioned guidance and customizable comment templates", () => {
        expect(JudgeCommentGuidanceSchema.safeParse(DEFAULT_JUDGE_COMMENT_GUIDANCE).success).toBe(
            true,
        );
        expect(
            RubricDefinitionSchema.safeParse({
                ...DEFAULT_RUBRIC_DEFINITION,
                commentGuidance: {
                    introduction: " ",
                    guidelines: ["Keep feedback specific."],
                    templates: [{ label: "Specific", body: "A reusable comment prompt." }],
                },
            }).success,
        ).toBe(false);
        expect(
            JudgeCommentGuidanceSchema.safeParse({
                ...DEFAULT_JUDGE_COMMENT_GUIDANCE,
                templates: [
                    { label: "Actionable", body: "One useful next step." },
                    { label: " actionable ", body: "Another useful next step." },
                ],
            }).success,
        ).toBe(false);
        expect(
            JudgeCommentGuidanceSchema.safeParse({
                ...DEFAULT_JUDGE_COMMENT_GUIDANCE,
                guidelines: Array.from({ length: 11 }, (_, index) => `Guideline ${index + 1}`),
            }).success,
        ).toBe(false);
    });

    it("requires a useful comment and rejects unfilled template guidance", () => {
        expect(isJudgeCommentReady("A clear strength with one practical next step.")).toBe(true);
        expect(isJudgeCommentReady("Too short")).toBe(false);
        expect(
            isJudgeCommentReady(
                "Strength: {{describe one specific feature}} and a practical next step.",
            ),
        ).toBe(false);
    });

    it("conservatively blocks the judge's exact email or display name", () => {
        expect(commentContainsJudgeIdentity("   \n", "judge@example.test", "Jordan Example")).toBe(
            false,
        );
        expect(
            commentContainsJudgeIdentity(
                "The prototype works well; contact JUDGE@example.test for more details.",
                "judge@example.test",
                "Jordan Example",
            ),
        ).toBe(true);
        expect(
            commentContainsJudgeIdentity(
                "Jordan   Example made a clear observation.",
                "judge@example.test",
                "Jordan Example",
            ),
        ).toBe(true);
        expect(
            commentContainsJudgeIdentity(
                "This is a thoughtful review with actionable ideas.",
                "judge@example.test",
                "Jordan Example",
            ),
        ).toBe(false);
        expect(
            commentContainsJudgeIdentity(
                "The project contains jordan@example.testimonials as sample text.",
                "jordan@example.test",
                "Jordan Example",
            ),
        ).toBe(false);
        expect(
            commentContainsJudgeIdentity(
                "Jordanian Exampleton is a fictional name.",
                "judge@example.test",
                "Jordan Example",
            ),
        ).toBe(false);
    });

    it("enforces comment guidance at the final submission boundary", () => {
        const scores = { quality: 4 };

        expect(
            SubmitTeamScoresRequest.safeParse({
                scores,
                reasoning: "A clear strength with one practical next step.",
                rubric_version_id: 1,
            }).success,
        ).toBe(true);
        expect(
            SubmitTeamScoresRequest.safeParse({
                scores,
                reasoning: "Too short",
                rubric_version_id: 1,
            }).success,
        ).toBe(false);
        expect(
            SubmitTeamScoresRequest.safeParse({
                scores,
                reasoning: "Strength: {{describe one specific feature}} and a practical next step.",
                rubric_version_id: 1,
            }).success,
        ).toBe(false);
    });
});
