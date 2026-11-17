import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "ProjectCard.vue"),
    "utf-8",
);

describe("ProjectCard.vue regressions", () => {
    it("binds the team name to the description prop", () => {
        expect(source).not.toContain("description=teamname");
        expect(source).toContain(':description="team.name"');
    });

    it("disables the Demo button based on the safe demo URL", () => {
        expect(source).toContain(':disabled="!safeDemoUrl"');
    });

    it("uses a supplied public team record without fetching the protected team endpoint", () => {
        expect(source).toContain("id: number");
        expect(source).toContain("team?: GetTeamResponse");
        expect(source).toContain("immediate: !props.team");
        expect(source).toContain("props.team ?? fetchedTeam.value");
    });

    it("shows the AI-use disclosure alongside the project description", () => {
        expect(source).toContain("AI-use disclosure");
        expect(source).toContain("team.project.sourcing");
        expect(source).toContain("This team did not provide an AI-use disclosure.");
    });
});
