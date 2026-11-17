import { describe, expect, it } from "vitest";
import { isJudgingOpen } from "~~/server/utils/judging";

const state = (overrides: Record<string, unknown> = {}) =>
    ({
        status: "voting",
        judging_open: 1,
        results_published: 0,
        ...overrides,
    }) as Pick<Hackathon, "status" | "judging_open" | "results_published">;

describe("isJudgingOpen", () => {
    it("is open during voting with judging enabled and results unpublished", () => {
        expect(isJudgingOpen(state())).toBe(true);
    });

    it("closes when the season is not voting", () => {
        expect(isJudgingOpen(state({ status: "finished" }))).toBe(false);
    });

    it("closes when judging is disabled", () => {
        expect(isJudgingOpen(state({ judging_open: 0 }))).toBe(false);
    });

    it("closes once results are published", () => {
        expect(isJudgingOpen(state({ results_published: 1 }))).toBe(false);
    });

    it("closes without live state", () => {
        expect(isJudgingOpen(null)).toBe(false);
    });
});
