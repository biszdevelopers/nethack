import { describe, expect, it, vi } from "vitest";
import { maximum, sampleAtInterval } from "../../scripts/benchmark-utils.mjs";

describe("startup benchmark aggregation", () => {
    it("keeps missing memory samples missing instead of treating them as zero", () => {
        expect(maximum([null, undefined])).toBeNull();
        expect(maximum([null, 42, 17])).toBe(42);
    });
});

describe("independent benchmark sampling", () => {
    it("keeps one-second sampling cadence independent of representative request duration", async () => {
        let clock = 0;
        let sampleCount = 0;

        await sampleAtInterval({
            durationMs: 30,
            intervalMs: 10,
            now: () => clock,
            sleep: async (milliseconds: number) => {
                clock += milliseconds;
            },
            sample: async () => {
                sampleCount += 1;
                clock += 15;
                return sampleCount;
            },
            onSample: () => undefined,
        });

        expect(sampleCount).toBe(2);
    });

    it("reports sampling failures and continues until the interval ends", async () => {
        let clock = 0;
        let attemptCount = 0;
        const errors: unknown[] = [];
        const samples: number[] = [];

        await sampleAtInterval({
            durationMs: 30,
            intervalMs: 10,
            now: () => clock,
            sleep: async (milliseconds: number) => {
                clock += milliseconds;
            },
            sample: async () => {
                attemptCount += 1;
                if (attemptCount === 1) throw new Error("sample unavailable");
                return attemptCount;
            },
            onSample: (sample: number) => samples.push(sample),
            onError: (error: unknown) => errors.push(error),
        });

        expect(errors).toHaveLength(1);
        expect(samples).toEqual([2, 3]);
    });

    it("stops immediately when the caller requests cancellation", async () => {
        let clock = 0;
        const sample = vi.fn(async () => 1);

        await sampleAtInterval({
            durationMs: 30,
            intervalMs: 10,
            shouldStop: () => true,
            now: () => clock,
            sleep: async (milliseconds: number) => {
                clock += milliseconds;
            },
            sample,
            onSample: () => undefined,
        });

        expect(sample).not.toHaveBeenCalled();
    });
});
