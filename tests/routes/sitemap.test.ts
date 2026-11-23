import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../api/helpers";

const state = vi.hoisted(() => ({
    seasons: [] as Array<Record<string, unknown>>,
    eventState: { galleryPublic: false, resultsVisible: false },
    config: { public: { siteOrigin: "" } },
    requestUrl: "https://request.example/current?tab=1",
    headers: [] as Array<[string, string]>,
}));

vi.mock("~~/server/utils/database/seasons", () => ({
    getSeasons: async () => state.seasons,
}));
vi.mock("~~/server/utils/event-state", () => ({
    getEventState: async () => state.eventState,
}));

let handler: (event: unknown) => Promise<string>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("useRuntimeConfig", () => state.config);
    vi.stubGlobal("getRequestURL", () => new URL(state.requestUrl));
    vi.stubGlobal("setHeader", (_event: unknown, name: string, value: string) => {
        state.headers.push([name, value]);
    });
    handler = (await import("~~/server/routes/sitemap.xml")).default;
});

beforeEach(() => {
    state.seasons = [];
    state.eventState = { galleryPublic: false, resultsVisible: false };
    state.config = { public: { siteOrigin: "" } };
    state.requestUrl = "https://request.example/current?tab=1";
    state.headers = [];
});

const urlEntries = (body: string) => body.split("</url>").slice(0, -1);

describe("GET /sitemap.xml", () => {
    it("lists the static routes against the request origin", async () => {
        const body = await handler({});

        expect(
            body.startsWith(
                '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ),
        ).toBe(true);
        expect(body.endsWith("</urlset>")).toBe(true);
        expect(body).toContain("<loc>https://request.example/</loc>");
        expect(body).toContain("<loc>https://request.example/rules</loc>");
        expect(body).toContain("<loc>https://request.example/faq</loc>");
        expect(body).toContain("<loc>https://request.example/contact</loc>");
        expect(body).toContain("<loc>https://request.example/contributing</loc>");
        expect(body).toContain("<loc>https://request.example/showcase</loc>");
        expect(body).toContain("<loc>https://request.example/showcase/beneath-the-surface</loc>");
        expect(body).toContain("<loc>https://request.example/showcase/signal</loc>");
        expect(body).not.toContain("/projects</loc>");
        expect(body).not.toContain("/results</loc>");
        expect(urlEntries(body)).toHaveLength(8);
        expect(state.headers).toEqual([
            ["content-type", "application/xml; charset=utf-8"],
            ["cache-control", "public, max-age=3600"],
        ]);
    });

    it("prefers the configured public origin and adds gated pages", async () => {
        state.config = { public: { siteOrigin: "https://site.example" } };
        state.eventState = { galleryPublic: true, resultsVisible: true };

        const body = await handler({});

        expect(body).toContain("<loc>https://site.example/projects</loc>");
        expect(body).toContain("<loc>https://site.example/results</loc>");
        expect(body).not.toContain("request.example");
        expect(urlEntries(body)).toHaveLength(10);
    });

    it("lists only published past seasons and keeps zero end timestamps out of lastmod", async () => {
        const end = Date.UTC(2026, 3, 20, 12, 0, 0);
        state.seasons = [
            { id: 1, is_active: 1, status: "finished", end_timestamp: end },
            { id: 2, is_active: 0, status: "not_started", end_timestamp: end },
            { id: 3, is_active: 0, status: "paused", end_timestamp: end },
            { id: 4, is_active: 0, status: "finished", end_timestamp: end },
            { id: 5, is_active: 0, status: "voting", end_timestamp: 0 },
        ];

        const body = await handler({});

        expect(body).not.toContain("/showcase/seasons/1");
        expect(body).not.toContain("/showcase/seasons/2");
        expect(body).not.toContain("/showcase/seasons/3");
        expect(body).toContain("<loc>https://request.example/showcase/seasons/4</loc>");
        expect(body).toContain(
            `<lastmod>${new Date(end).toISOString()}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority>`,
        );
        const seasonFive = urlEntries(body).find((entry) => entry.includes("/showcase/seasons/5"));
        expect(seasonFive).toBeDefined();
        expect(seasonFive).not.toContain("<lastmod>");
    });

    it("escapes XML metacharacters and falls back to raw paths for an invalid origin", async () => {
        state.config = { public: { siteOrigin: "not a valid origin" } };
        state.seasons = [
            {
                id: "a&b<c>d\"e'f",
                is_active: 0,
                status: "finished",
                end_timestamp: 0,
            },
        ];

        const body = await handler({});

        expect(body).toContain("<loc>/showcase/seasons/a&amp;b&lt;c&gt;d&quot;e&apos;f</loc>");
        expect(body).not.toContain("<loc>not a valid origin/");
    });

    it("returns no season entries when there is nothing to publish", async () => {
        const body = await handler({});

        expect(body).toContain("<urlset");
        expect(body).not.toContain("<loc>/showcase/seasons");
        expect(urlEntries(body)).toHaveLength(8);
    });
});
