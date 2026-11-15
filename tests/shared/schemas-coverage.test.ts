import { describe, expect, it } from "vitest";
import {
    AdminUpdateHackathonRequest,
    CreateRubricVersionRequest,
    RubricDefinitionSchema,
    RubricTrackSchema,
    RubricCriterionSchema,
    SaveJudgingDraftRequest,
    SubmitTeamScoresRequest,
} from "~~/shared/schemas";

const validCriterion = {
    id: "idea",
    name: "Originality",
    description: "How original is the project?",
    weight: 100,
    minScore: 0,
    maxScore: 5,
};

const validTrack = {
    name: "Junior",
    criteria: [validCriterion],
};

const validDefinition = {
    tracks: { junior: validTrack },
};

describe("rubric validation boundaries", () => {
    it("accepts criterion score bounds with a higher maximum and rejects an inverted range", () => {
        expect(RubricCriterionSchema.safeParse(validCriterion).success).toBe(true);
        expect(
            RubricCriterionSchema.safeParse({ ...validCriterion, minScore: 5, maxScore: 5 })
                .success,
        ).toBe(false);
    });

    it("requires unique criterion IDs and weights totaling 100", () => {
        expect(RubricTrackSchema.safeParse(validTrack).success).toBe(true);
        expect(
            RubricTrackSchema.safeParse({
                ...validTrack,
                criteria: [
                    { ...validCriterion, weight: 50 },
                    { ...validCriterion, weight: 50 },
                ],
            }).success,
        ).toBe(false);
        expect(
            RubricTrackSchema.safeParse({
                ...validTrack,
                criteria: [
                    { ...validCriterion, weight: 50 },
                    { ...validCriterion, id: "impact", weight: 49 },
                ],
            }).success,
        ).toBe(false);
    });

    it("requires between one and eight rubric tracks", () => {
        expect(RubricDefinitionSchema.safeParse(validDefinition).success).toBe(true);
        expect(RubricDefinitionSchema.safeParse({ tracks: {} }).success).toBe(false);
        const nineTracks = Object.fromEntries(
            Array.from({ length: 9 }, (_, index) => [`track-${index}`, validTrack]),
        );
        expect(RubricDefinitionSchema.safeParse({ tracks: nineTracks }).success).toBe(false);
    });
});

describe("judging request validation boundaries", () => {
    it("defaults omitted draft reasoning and validates supplied dynamic scores", () => {
        expect(
            SaveJudgingDraftRequest.parse({
                scores: { idea: 4 },
                rubric_version_id: 1,
            }),
        ).toEqual({ scores: { idea: 4 }, reasoning: "", rubric_version_id: 1 });
        expect(
            SaveJudgingDraftRequest.safeParse({
                scores: { "Bad ID": 4 },
                rubric_version_id: 1,
            }).success,
        ).toBe(false);
    });

    it("accepts complete judge feedback and rejects an unfilled comment template", () => {
        const base = { scores: { idea: 4 }, rubric_version_id: 1 };
        expect(
            SubmitTeamScoresRequest.safeParse({
                ...base,
                reasoning: "The team explained its design clearly.",
            }).success,
        ).toBe(true);
        expect(
            SubmitTeamScoresRequest.safeParse({
                ...base,
                reasoning: "The team improved {{project area}} clearly.",
            }).success,
        ).toBe(false);
    });
});

describe("rubric version source validation", () => {
    it("requires exactly one definition, season, or template source", () => {
        expect(CreateRubricVersionRequest.safeParse({ name: "Rubric" }).success).toBe(false);
        expect(
            CreateRubricVersionRequest.safeParse({ name: "Rubric", definition: validDefinition })
                .success,
        ).toBe(true);
        expect(
            CreateRubricVersionRequest.safeParse({ name: "Rubric", copyFromSeasonId: "3" }).success,
        ).toBe(true);
        expect(
            CreateRubricVersionRequest.safeParse({ name: "Rubric", sourceTemplateId: "4" }).success,
        ).toBe(true);
        expect(
            CreateRubricVersionRequest.safeParse({
                name: "Rubric",
                copyFromSeasonId: 3,
                sourceTemplateId: 4,
            }).success,
        ).toBe(false);
    });
});

describe("admin hackathon timestamp defaults", () => {
    it("maps explicit null timestamps to zero and preserves non-null timestamps", () => {
        const nulls = AdminUpdateHackathonRequest.parse({
            start_timestamp: null,
            end_timestamp: null,
            voting_start_timestamp: null,
            voting_end_timestamp: null,
            results_open_timestamp: null,
        });
        expect(nulls).toMatchObject({
            start_timestamp: 0,
            end_timestamp: 0,
            voting_start_timestamp: 0,
            voting_end_timestamp: 0,
            results_open_timestamp: 0,
        });

        expect(
            AdminUpdateHackathonRequest.parse({
                start_timestamp: 10,
                end_timestamp: 20,
                voting_start_timestamp: 30,
                voting_end_timestamp: 40,
                results_open_timestamp: 50,
            }),
        ).toMatchObject({
            start_timestamp: 10,
            end_timestamp: 20,
            voting_start_timestamp: 30,
            voting_end_timestamp: 40,
            results_open_timestamp: 50,
        });
    });
});
