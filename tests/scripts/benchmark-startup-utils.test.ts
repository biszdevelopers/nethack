import { describe, expect, it } from "vitest";
import { maximum } from "../../scripts/benchmark-utils.mjs";

describe("startup benchmark aggregation", () => {
    it("keeps missing memory samples missing instead of treating them as zero", () => {
        expect(maximum([null, undefined])).toBeNull();
        expect(maximum([null, 42, 17])).toBe(42);
    });
});
