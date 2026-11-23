import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "developers", "judging.vue"),
    "utf-8",
);

describe("admin judge coverage page", () => {
    it("lists assignments and supports creating and deleting them", () => {
        expect(source).toContain('"/api/admin/judging/assignments"');
        expect(source).toContain('method: "POST"');
        expect(source).toContain("`/api/admin/judging/assignments?id=${id}`");
        expect(source).toContain('method: "DELETE"');
    });

    it("shows coverage per judge and per scope", () => {
        expect(source).toContain("coverageLabel");
        expect(source).toContain("coverageCount");
        expect(source).toContain("Every submitted project");
        expect(source).toContain("Track:");
        expect(source).toContain("Only ");
    });

    it("resolves organizer flags", () => {
        expect(source).toContain('"/api/admin/judging/flags"');
        expect(source).toContain("`/api/admin/judging/flags/${flag.id}`");
        expect(source).toContain('body: { status: "resolved" }');
    });

    it("degrades neutrally when the endpoints are unavailable", () => {
        expect(source).toContain("isEndpointUnavailable");
        expect(source).toContain("Judge assignments are not enabled");
        expect(source).toContain("Judge flags are not enabled");
    });

    it("uses the developer dashboard layout and a document title", () => {
        expect(source).toContain('layout: "developers-dashboard"');
        expect(source).toContain("Judge coverage | ${WEBSITE_NAME}");
    });
});
