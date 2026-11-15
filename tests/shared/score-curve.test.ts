import { applyScoreCurve, SCORE_CURVE_PRESETS } from "~~/shared/score-curve";

describe("score display curves", () => {
    it("preserves scores when the original preset is selected", () => {
        expect(applyScoreCurve(0, "original")).toBe(0);
        expect(applyScoreCurve(63, "original")).toBe(63);
        expect(applyScoreCurve(100, "original")).toBe(100);
    });

    it("keeps every preset within the 0–100 range", () => {
        for (const preset of Object.keys(
            SCORE_CURVE_PRESETS,
        ) as (keyof typeof SCORE_CURVE_PRESETS)[]) {
            expect(applyScoreCurve(-10, preset)).toBe(0);
            expect(applyScoreCurve(120, preset)).toBe(100);
        }
    });

    it("applies progressively stronger upward curves without mutating the original value", () => {
        const original = 50;
        const scores = [
            applyScoreCurve(original, "gentle"),
            applyScoreCurve(original, "moderate"),
            applyScoreCurve(original, "strong"),
        ];

        expect(scores[0]).toBeGreaterThan(original);
        expect(scores[1]).toBeGreaterThan(scores[0]!);
        expect(scores[2]).toBeGreaterThan(scores[1]!);
        expect(original).toBe(50);
    });
});
