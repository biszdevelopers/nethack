import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "seasons", "[id].vue"),
    "utf-8",
);

describe("public season rubric", () => {
    it("loads the public active rubric", () => {
        expect(source).toContain('"/api/seasons/active/rubric"');
        expect(source).toContain("rubricTracks");
        expect(source).toContain("rubric.version_id");
    });

    it("shows tracks, criteria, weights, and score ranges", () => {
        expect(source).toContain("track.criteria");
        expect(source).toContain("criterion.weight");
        expect(source).toContain("criterion.minScore");
        expect(source).toContain("criterion.maxScore");
        expect(source).toContain("Judging rubric");
    });

    it("explains the display curve without changing rankings", () => {
        expect(source).toContain("SCORE_CURVE_PRESETS");
        expect(source).toContain("displayCurve");
        expect(source).toContain("Rankings are unaffected");
        expect(source).toContain("original");
    });

    it("fails gracefully when the rubric is unavailable", () => {
        expect(source).toContain("rubricError");
        expect(source).toContain("is not published yet or could not be loaded");
    });

    it("links the active schedule as a calendar download", () => {
        expect(source).toContain('href="/calendar.ics"');
        expect(source).toContain("download");
    });
});
