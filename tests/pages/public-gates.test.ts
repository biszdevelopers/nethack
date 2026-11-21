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
    it("fails closed when the season does not expose gallery flags", () => {
        expect(projects).toContain("is_gallery_public");
        expect(projects).toContain("is_submission_closed");
        expect(projects).toContain("Boolean(season.value?.is_gallery_public");
        expect(projects).toContain("immediate: galleryOpen.value");
    });

    it("explains the hidden state without loading project data", () => {
        expect(projects).toContain("Projects are hidden until submissions close");
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
    it("separates the event name from the platform name", () => {
        expect(home).toContain("BIBS-C Network Hackathon");
        expect(home).toContain("{{ WEBSITE_NAME }}");
    });

    it("describes eligibility, dates, prizes, team size, and time commitment", () => {
        expect(home).toContain("BIBS-C Network students with a basis-auth account");
        expect(home).toContain("First, Second, and Third Prize");
        expect(home).toContain("MAX_TEAM_MEMBERS");
        expect(home).toContain("Asia/Shanghai (UTC+8)");
    });

    it("renders a visible status-aware CTA", () => {
        expect(home).toContain('label: "Sign in to join"');
        expect(home).toContain('label: "Go to dashboard"');
        expect(home).toContain('label: "See results"');
        expect(home).not.toContain('class="sr-only"');
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
