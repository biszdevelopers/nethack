import { describe, expect, it } from "vitest";
import {
    calculateWeightedRubricScore,
    validateRubricScores,
    type RubricTrack,
} from "~~/shared/rubric";

const track: RubricTrack = {
    name: "Bounded judging track",
    criteria: [
        {
            id: "clarity",
            name: "Clarity",
            description: "How clearly the submission explains its idea.",
            weight: 70,
            minScore: 1,
            maxScore: 5,
        },
        {
            id: "craft",
            name: "Craft",
            description: "The care taken with implementation.",
            weight: 30,
            minScore: 0,
            maxScore: 10,
        },
    ],
};

describe("rubric score validation actions", () => {
    it("accepts complete in-range integer scores", () => {
        expect(validateRubricScores(track, { clarity: 1, craft: 10 })).toEqual([]);
    });

    it.each([
        ["fractional", 1.5],
        ["below the minimum", 0],
        ["above the maximum", 6],
        ["infinite", Number.POSITIVE_INFINITY],
    ] as const)("rejects a clarity score that is %s", (_description, score) => {
        expect(validateRubricScores(track, { clarity: score, craft: 5 })).toEqual([
            "Clarity must be an integer from 1 to 5.",
        ]);
    });

    it("reports unknown criteria without treating them as rubric criteria", () => {
        expect(validateRubricScores(track, { clarity: 3, craft: 5, extra: -20 })).toEqual([
            "Unknown criterion: extra",
        ]);
    });

    it("reports every missing criterion when partial scoring is disabled", () => {
        expect(validateRubricScores(track, { clarity: 3 })).toEqual(["Missing score for Craft."]);
    });

    it("allows missing criteria in draft scoring while still validating provided values", () => {
        expect(validateRubricScores(track, {}, { allowPartial: true })).toEqual([]);
        expect(validateRubricScores(track, { clarity: 6 }, { allowPartial: true })).toEqual([
            "Clarity must be an integer from 1 to 5.",
        ]);
    });
});

describe("weighted rubric normalization boundaries", () => {
    it("uses the configured minimum when a criterion has no submitted score", () => {
        expect(
            calculateWeightedRubricScore(
                {
                    name: "Missing score",
                    criteria: [
                        {
                            id: "proof",
                            name: "Proof",
                            description: "Evidence of a working result.",
                            weight: 100,
                            minScore: 2,
                            maxScore: 6,
                        },
                    ],
                },
                {},
            ),
        ).toBe(0);
    });

    it("assigns no normalized contribution to a criterion with a zero-width range", () => {
        expect(
            calculateWeightedRubricScore(
                {
                    name: "Fixed scale",
                    criteria: [
                        {
                            id: "fixed",
                            name: "Fixed",
                            description: "A criterion with the only possible score.",
                            weight: 100,
                            minScore: 4,
                            maxScore: 4,
                        },
                    ],
                },
                { fixed: 4 },
            ),
        ).toBe(0);
    });
});
