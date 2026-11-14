/** Score curves are presentation-only. Persisted and ranked scores remain unchanged. */
export const SCORE_CURVE_PRESETS = {
    original: { label: "Original score", exponent: 1 },
    gentle: { label: "Gentle uplift", exponent: 0.9 },
    moderate: { label: "Moderate uplift", exponent: 0.8 },
    strong: { label: "Strong uplift", exponent: 0.65 },
} as const;

export type ScoreCurvePreset = keyof typeof SCORE_CURVE_PRESETS;

export function isScoreCurvePreset(value: unknown): value is ScoreCurvePreset {
    return typeof value === "string" && Object.hasOwn(SCORE_CURVE_PRESETS, value);
}

export function applyScoreCurve(rawScore: number, preset: ScoreCurvePreset): number {
    const boundedScore = Math.min(100, Math.max(0, rawScore));
    const exponent = SCORE_CURVE_PRESETS[preset].exponent;
    return Math.round(100 * Math.pow(boundedScore / 100, exponent));
}
