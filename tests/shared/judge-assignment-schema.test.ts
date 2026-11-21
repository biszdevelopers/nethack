import { describe, expect, it } from "vitest";
import { JudgeAssignmentRequest } from "~~/shared/schemas";

describe("judge assignment request shape", () => {
    it("accepts a pathway-only assignment", () => {
        expect(
            JudgeAssignmentRequest.safeParse({ judge_user_id: 3, pathway: "junior" }).success,
        ).toBe(true);
    });

    it("accepts a team-only assignment", () => {
        expect(JudgeAssignmentRequest.safeParse({ judge_user_id: 3, team_id: 7 }).success).toBe(
            true,
        );
    });

    it("accepts an assignment with neither target", () => {
        expect(JudgeAssignmentRequest.safeParse({ judge_user_id: 3 }).success).toBe(true);
    });

    it("rejects assigning one judge to both a pathway and a team", () => {
        const result = JudgeAssignmentRequest.safeParse({
            judge_user_id: 3,
            pathway: "junior",
            team_id: 7,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toContain(
                "Assign a judge to a pathway or a team, not both",
            );
        }
    });
});
