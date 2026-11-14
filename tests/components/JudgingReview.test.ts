import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "JudgingReview.vue"),
    "utf-8",
);

describe("JudgingReview.vue", () => {
    it("shows configured minimum and maximum values for each criterion", () => {
        expect(source).toContain("{{ criterion.minScore }}–{{ criterion.maxScore }}");
    });

    it("explains anonymous feedback publication and requires an explicit finalize action", () => {
        expect(source).toContain("Teams can see the feedback after results");
        expect(source).toContain("your identity will not be shown");
        expect(source).toContain("Finalize evaluation");
    });
});
