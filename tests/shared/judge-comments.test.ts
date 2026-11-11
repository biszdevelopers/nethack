import { describe, expect, it } from "vitest";
import { isJudgeCommentReady } from "../../shared/judge-comments";
import { SubmitTeamScoresRequest } from "../../shared/schemas";

describe("judge comment templates", () => {
    it("requires a useful comment and rejects unfilled template guidance", () => {
        expect(isJudgeCommentReady("A clear strength with one practical next step.")).toBe(true);
        expect(isJudgeCommentReady("Too short")).toBe(false);
        expect(
            isJudgeCommentReady(
                "Strength: {{describe one specific feature}} and a practical next step.",
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
