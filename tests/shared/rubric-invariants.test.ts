import { describe, expect, it } from "vitest";
import {
    calculateWeightedRubricScore,
    type RubricCriterion,
    type RubricTrack,
} from "~~/shared/rubric";

/** Deterministic PRNG so a failure is always reproducible. */
function seeded(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return state / 4_294_967_296;
    };
}

function criterion(
    id: string,
    weight: number,
    minScore: number,
    maxScore: number,
): RubricCriterion {
    return { id, name: id, description: "", weight, minScore, maxScore };
}

describe("weighted rubric score invariants", () => {
    it("maps the minimum to 0 and the maximum to the weight total", () => {
        const track: RubricTrack = {
            name: "Custom",
            criteria: [
                criterion("a", 45, -2, 8),
                criterion("b", 30, 1, 4),
                criterion("c", 25, 0, 3),
            ],
        };

        expect(calculateWeightedRubricScore(track, { a: -2, b: 1, c: 0 })).toBe(0);
        expect(calculateWeightedRubricScore(track, { a: 8, b: 4, c: 3 })).toBe(100);
    });

    it("never produces NaN or Infinity for randomized valid rubrics", () => {
        const random = seeded(20261116);

        for (let round = 0; round < 200; round += 1) {
            const criteria: RubricCriterion[] = Array.from(
                { length: 1 + Math.floor(random() * 6) },
                (_, index) => {
                    const minScore = Math.floor(random() * 5);
                    const maxScore = minScore + Math.floor(random() * 6);
                    return criterion(
                        `criterion-${index}`,
                        Math.floor(random() * 60),
                        minScore,
                        maxScore,
                    );
                },
            );
            const track: RubricTrack = { name: "Random", criteria };
            const scores = Object.fromEntries(
                criteria.map((item) => [
                    item.id,
                    item.minScore + Math.floor(random() * (item.maxScore - item.minScore + 1)),
                ]),
            );

            const result = calculateWeightedRubricScore(track, scores);
            const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);

            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(totalWeight);
        }
    });

    it("never decreases when one criterion score rises", () => {
        const track: RubricTrack = {
            name: "Custom",
            criteria: [criterion("a", 40, 0, 5), criterion("b", 60, 0, 5)],
        };

        for (let a = 0; a <= 5; a += 1) {
            for (let b = 0; b <= 5; b += 1) {
                const current = calculateWeightedRubricScore(track, { a, b });
                const higher = calculateWeightedRubricScore(track, { a: a + 1, b });
                expect(higher).toBeGreaterThanOrEqual(current);
            }
        }
    });

    it("treats a zero-range criterion as satisfied at either bound", () => {
        const track: RubricTrack = {
            name: "Custom",
            criteria: [criterion("fixed", 50, 3, 3), criterion("free", 50, 0, 4)],
        };

        expect(calculateWeightedRubricScore(track, { fixed: 3, free: 4 })).toBe(50);
        expect(calculateWeightedRubricScore(track, { fixed: 3, free: 0 })).toBe(0);
        expect(Number.isFinite(calculateWeightedRubricScore(track, { fixed: 3, free: 2 }))).toBe(
            true,
        );
    });

    it("treats a missing criterion as its minimum instead of failing", () => {
        const track: RubricTrack = {
            name: "Custom",
            criteria: [criterion("a", 50, 0, 10), criterion("b", 50, 0, 10)],
        };

        expect(calculateWeightedRubricScore(track, { a: 10 })).toBe(50);
    });
});
