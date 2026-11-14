import { describe, it, expect } from "vitest";
import rubrics from "~~/shared/rubric";
import {
    calculateWeightedRubricScore,
    DEFAULT_RUBRIC_DEFINITION,
    type RubricTrack,
} from "~~/shared/rubric";

describe("rubrics", () => {
    it("has both junior and senior rubrics", () => {
        expect(rubrics).toHaveProperty("junior");
        expect(rubrics).toHaveProperty("senior");
    });

    describe("junior rubric", () => {
        const junior = rubrics.junior;

        it("has exactly 5 criteria", () => {
            expect(Object.keys(junior)).toHaveLength(5);
        });

        it("has the expected criteria keys", () => {
            expect(junior).toHaveProperty("originality");
            expect(junior).toHaveProperty("presentation");
            expect(junior).toHaveProperty("technicality");
            expect(junior).toHaveProperty("theme");
            expect(junior).toHaveProperty("impact");
        });

        it("each criterion has abbr, name, description, and weight", () => {
            for (const [key, criterion] of Object.entries(junior)) {
                expect(criterion).toHaveProperty("abbr");
                expect(criterion).toHaveProperty("name");
                expect(criterion).toHaveProperty("description");
                expect(criterion).toHaveProperty("weight");
                expect(typeof criterion.abbr).toBe("string");
                expect(typeof criterion.name).toBe("string");
                expect(typeof criterion.description).toBe("string");
                expect(typeof criterion.weight).toBe("number");
            }
        });

        it("weights sum to 100", () => {
            const total = Object.values(junior).reduce((sum, c) => sum + c.weight, 0);
            expect(total).toBe(100);
        });

        it("abbr values are unique", () => {
            const abbrs = Object.values(junior).map((c) => c.abbr);
            expect(new Set(abbrs).size).toBe(abbrs.length);
        });

        it("has correct originality criterion", () => {
            expect(junior.originality.abbr).toBe("ORG");
            expect(junior.originality.weight).toBe(30);
        });

        it("has correct presentation criterion", () => {
            expect(junior.presentation.abbr).toBe("PRE");
            expect(junior.presentation.weight).toBe(25);
        });

        it("has correct technicality criterion", () => {
            expect(junior.technicality.abbr).toBe("TEC");
            expect(junior.technicality.weight).toBe(20);
        });

        it("has correct theme criterion", () => {
            expect(junior.theme.abbr).toBe("THM");
            expect(junior.theme.weight).toBe(15);
        });

        it("has correct impact criterion", () => {
            expect(junior.impact.abbr).toBe("IMP");
            expect(junior.impact.weight).toBe(10);
        });
    });

    describe("senior rubric", () => {
        const senior = rubrics.senior;

        it("has exactly 5 criteria", () => {
            expect(Object.keys(senior)).toHaveLength(5);
        });

        it("has the expected criteria keys", () => {
            expect(senior).toHaveProperty("impact");
            expect(senior).toHaveProperty("presentation");
            expect(senior).toHaveProperty("technicality");
            expect(senior).toHaveProperty("theme");
            expect(senior).toHaveProperty("originality");
        });

        it("each criterion has abbr, name, description, and weight", () => {
            for (const [key, criterion] of Object.entries(senior)) {
                expect(criterion).toHaveProperty("abbr");
                expect(criterion).toHaveProperty("name");
                expect(criterion).toHaveProperty("description");
                expect(criterion).toHaveProperty("weight");
                expect(typeof criterion.abbr).toBe("string");
                expect(typeof criterion.name).toBe("string");
                expect(typeof criterion.description).toBe("string");
                expect(typeof criterion.weight).toBe("number");
            }
        });

        it("weights sum to 100", () => {
            const total = Object.values(senior).reduce((sum, c) => sum + c.weight, 0);
            expect(total).toBe(100);
        });

        it("abbr values are unique", () => {
            const abbrs = Object.values(senior).map((c) => c.abbr);
            expect(new Set(abbrs).size).toBe(abbrs.length);
        });

        it("has correct impact criterion", () => {
            expect(senior.impact.abbr).toBe("IMP");
            expect(senior.impact.weight).toBe(30);
        });

        it("has correct presentation criterion", () => {
            expect(senior.presentation.abbr).toBe("PRE");
            expect(senior.presentation.weight).toBe(25);
        });

        it("has correct technicality criterion", () => {
            expect(senior.technicality.abbr).toBe("TEC");
            expect(senior.technicality.weight).toBe(20);
        });

        it("has correct theme criterion", () => {
            expect(senior.theme.abbr).toBe("THM");
            expect(senior.theme.weight).toBe(15);
        });

        it("has correct originality criterion", () => {
            expect(senior.originality.abbr).toBe("ORG");
            expect(senior.originality.weight).toBe(10);
        });
    });
});

describe("weighted rubric scoring", () => {
    it("keeps the default Junior scale normalized to 0 through 100", () => {
        const track = DEFAULT_RUBRIC_DEFINITION.tracks.junior!;
        const maximumScores = Object.fromEntries(
            track.criteria.map((criterion) => [criterion.id, criterion.maxScore]),
        );

        expect(calculateWeightedRubricScore(track, maximumScores)).toBe(100);
        expect(
            calculateWeightedRubricScore(
                track,
                Object.fromEntries(track.criteria.map((criterion) => [criterion.id, 0])),
            ),
        ).toBe(0);
    });

    it("normalizes each criterion's integer scale before applying weights", () => {
        const track: RubricTrack = {
            name: "Prototype",
            criteria: [
                {
                    id: "clarity",
                    name: "Clarity",
                    description: "How clearly the project solves a problem.",
                    weight: 60,
                    minScore: 1,
                    maxScore: 10,
                },
                {
                    id: "craft",
                    name: "Craft",
                    description: "How carefully the team built the project.",
                    weight: 40,
                    minScore: 1,
                    maxScore: 5,
                },
            ],
        };

        expect(calculateWeightedRubricScore(track, { clarity: 6, craft: 1 })).toBeCloseTo(100 / 3);
    });

    it("preserves judge precision until the final team average", () => {
        const track: RubricTrack = {
            name: "Precision check",
            criteria: [
                {
                    id: "score",
                    name: "Score",
                    description: "A wide integer range used to expose rounding behavior.",
                    weight: 100,
                    minScore: 0,
                    maxScore: 10_000,
                },
            ],
        };
        const judgeScores = [51, 51, 10].map((score) =>
            calculateWeightedRubricScore(track, { score }),
        );

        expect(
            Math.round(judgeScores.reduce((sum, score) => sum + score, 0) / judgeScores.length),
        ).toBe(0);
        expect(
            Math.round(
                judgeScores.map(Math.round).reduce((sum, score) => sum + score, 0) /
                    judgeScores.length,
            ),
        ).toBe(1);
    });
});
