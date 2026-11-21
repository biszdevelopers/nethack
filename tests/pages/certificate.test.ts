import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "certificate", "[id].vue"),
    "utf-8",
);

describe("public certificate page", () => {
    it("loads the public team record and its season", () => {
        expect(source).toContain("`/api/teams/${certificateID}`");
        expect(source).toContain('"/api/seasons"');
        expect(source).toContain("results_published");
    });

    it("shows the team, project, rank, awards, and season when published", () => {
        expect(source).toContain("team.project.name");
        expect(source).toContain("team.rank");
        expect(source).toContain("team.awards");
        expect(source).toContain("season.name");
        expect(source).toContain("Certificate of Achievement");
    });

    it("shows a clear unavailable state instead of failing", () => {
        expect(source).toContain("Certificate not available");
        expect(source).toContain("have not been published yet");
        expect(source).toContain("teamError");
    });

    it("prints without exposing personal contact details", () => {
        expect(source).toContain("window.print()");
        expect(source).toContain("@media print");
        expect(source).toContain("no-print");
        expect(source).not.toContain("email");
        expect(source).not.toContain("members");
    });

    it("is marked noindex and has a title", () => {
        expect(source).toContain('content: "noindex, nofollow"');
        expect(source).toContain("useHead(");
    });
});
