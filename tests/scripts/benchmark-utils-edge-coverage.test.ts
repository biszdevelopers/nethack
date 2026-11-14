import { describe, expect, it, vi } from "vitest";
import { maximum, sampleAtInterval } from "../../scripts/benchmark-utils.mjs";

describe("benchmark utility edge cases", () => {
    it("returns null when no input is finite", () => {
        expect(maximum([])).toBeNull();
        expect(
            maximum([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
        ).toBeNull();
    });

    it("uses the default clock, stop condition, and sleep while sampling", async () => {
        const samples: number[] = [];
        let nextSample = 0;

        await sampleAtInterval({
            durationMs: 1_000,
            intervalMs: 10,
            sample: async () => ++nextSample,
            onSample: (sample: number) => samples.push(sample),
        });

        expect(samples.length).toBeGreaterThan(1);
        expect(samples).toEqual(Array.from({ length: samples.length }, (_, index) => index + 1));
    });
});
