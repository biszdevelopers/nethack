import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");

const projects = readSource("app", "pages", "projects.vue");
const results = readSource("app", "pages", "results.vue");
const home = readSource("app", "pages", "index.vue");
const sitemap = readSource("server", "routes", "sitemap.xml.ts");

describe("public gallery gate", () => {
    it("fails closed when the season does not expose the gallery flag", () => {
        expect(projects).toContain("is_gallery_public");
        expect(projects).toContain("Boolean(season.value?.is_gallery_public)");
        expect(projects).not.toContain("is_submission_closed");
        expect(projects).toContain("immediate: galleryOpen.value");
    });

    it("explains the hidden state without loading project data", () => {
        expect(projects).toContain("Projects are hidden until peer voting opens");
        expect(projects).toContain('v-if="!galleryOpen"');
        expect(projects).toContain('useApiFetch<GetTeamResponse[]>("/api/teams"');
    });

    it("keeps the gallery out of search results until it opens", () => {
        expect(projects).toContain('robots: galleryOpen.value ? "index, follow"');
        expect(projects).toContain('"noindex, nofollow"');
    });

    it("offers search, pathway filtering, and project detail links", () => {
        expect(projects).toContain('v-model="search"');
        expect(projects).toContain('v-model="pathway"');
        expect(projects).toContain("{ path: '/projects', query: { project: team.id } }");
    });
});

describe("public results gate", () => {
    it("reads results publication from the season record", () => {
        expect(results).toContain("results_published");
        expect(results).toContain("immediate: published.value");
        expect(results).toContain("Results not published yet");
    });

    it("adds results to search only after publication", () => {
        expect(results).toContain('robots: published.value ? "index, follow"');
        expect(results).toContain('"noindex, nofollow"');
    });

    it("hides People's Choice when the ballot endpoint is unavailable", () => {
        expect(results).toContain("/api/ballot/results");
        expect(results).toContain('v-if="peopleChoice"');
        expect(results).toContain("normalizeBallotResults");
    });
});

describe("landing page contract", () => {
    it("puts the schedule, theme, how-it-works, and FAQ in order", () => {
        const schedule = home.indexOf('id="schedule-heading"');
        const theme = home.indexOf('id="theme-heading"');
        const how = home.indexOf('id="how-it-works-heading"');
        const faq = home.indexOf('id="faq-heading"');
        expect(schedule).toBeGreaterThan(-1);
        expect(schedule).toBeLessThan(theme);
        expect(theme).toBeLessThan(how);
        expect(how).toBeLessThan(faq);
    });

    it("keeps the schedule copy, timezone, and theme details", () => {
        expect(home).toContain("Asia/Shanghai (UTC+8)");
        expect(home).toContain("Detailed schedule");
        expect(home).toContain("The theme will be revealed");
        expect(home).not.toContain("MAX_TEAM_MEMBERS");
        expect(home).not.toContain("First, Second, and Third Prize");
    });

    it("does not reintroduce a generic hero or all-caps labels", () => {
        expect(home).not.toContain("The official event platform is");
        expect(home).not.toContain("primaryCta");
        expect(home).not.toContain("uppercase");
    });

    it("links internally with to instead of href", () => {
        expect(home).not.toMatch(/<UButton[^>]*\shref=/);
        expect(home).not.toMatch(/<ULink[^>]*\shref=/);
    });
});

describe("sitemap gating", () => {
    it("only lists gated routes when their gates are open", () => {
        expect(sitemap).toContain("if (galleryOpen)");
        expect(sitemap).toContain("if (resultsPublished)");
        expect(sitemap).toContain('"/projects"');
        expect(sitemap).toContain('"/results"');
    });

    it("excludes unannounced and active seasons from archives", () => {
        expect(sitemap).toContain('season.status === "not_started"');
        expect(sitemap).toContain('season.status === "paused"');
        expect(sitemap).toContain("season.is_active");
    });

    it("serves XML with caching", () => {
        expect(sitemap).toContain("application/xml");
        expect(sitemap).toContain("cache-control");
    });
});
