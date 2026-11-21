import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageSeo, pageSeo, resolveSeoUrl } from "~~/app/utils/seo";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("SEO URL resolution", () => {
    it("keeps absolute URLs and relative values without an origin", () => {
        expect(resolveSeoUrl("https://cdn.example/image.png")).toBe(
            "https://cdn.example/image.png",
        );
        expect(resolveSeoUrl("HTTP://cdn.example/image.png")).toBe("HTTP://cdn.example/image.png");
        expect(resolveSeoUrl("/rules")).toBe("/rules");
        expect(resolveSeoUrl("/rules", "")).toBe("/rules");
    });

    it("resolves a relative path against a valid origin", () => {
        expect(resolveSeoUrl("/rules", "https://site.example")).toBe("https://site.example/rules");
    });

    it("returns the raw value when the origin cannot be parsed", () => {
        expect(resolveSeoUrl("/rules", "not a url")).toBe("/rules");
    });
});

describe("page SEO metadata", () => {
    it("builds a minimal website entry with a canonical root path", () => {
        const seo = buildPageSeo({ title: "Basishacks" }, "https://site.example");

        expect(seo.title).toBe("Basishacks");
        expect(seo.link).toEqual([{ rel: "canonical", href: "https://site.example/" }]);
        expect(seo.meta).toEqual([
            { property: "og:title", content: "Basishacks" },
            { property: "og:url", content: "https://site.example/" },
            { property: "og:type", content: "website" },
            { name: "twitter:card", content: "summary" },
            { name: "twitter:title", content: "Basishacks" },
        ]);
    });

    it("adds trimmed descriptions, resolved images, article type, and robots", () => {
        const seo = buildPageSeo(
            {
                title: "Season results",
                description: "  Final standings  ",
                path: "/results",
                type: "article",
                image: "/cover.png",
                robots: "noindex",
            },
            "https://site.example",
        );

        expect(seo.link).toEqual([{ rel: "canonical", href: "https://site.example/results" }]);
        expect(seo.meta).toContainEqual({ name: "description", content: "Final standings" });
        expect(seo.meta).toContainEqual({ property: "og:description", content: "Final standings" });
        expect(seo.meta).toContainEqual({
            name: "twitter:description",
            content: "Final standings",
        });
        expect(seo.meta).toContainEqual({ property: "og:type", content: "article" });
        expect(seo.meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
        expect(seo.meta).toContainEqual({
            property: "og:image",
            content: "https://site.example/cover.png",
        });
        expect(seo.meta).toContainEqual({
            name: "twitter:image",
            content: "https://site.example/cover.png",
        });
        expect(seo.meta).toContainEqual({ name: "robots", content: "noindex" });
    });

    it("omits blank descriptions and keeps an absolute image untouched", () => {
        const seo = buildPageSeo(
            { title: "Rules", description: "   ", image: "https://cdn.example/og.png" },
            "https://site.example",
        );

        expect(seo.meta.some((entry) => entry.name === "description")).toBe(false);
        expect(seo.meta).toContainEqual({
            property: "og:image",
            content: "https://cdn.example/og.png",
        });
    });
});

describe("pageSeo runtime resolution", () => {
    const runtimeConfig = { public: { siteOrigin: "https://config.example" } };
    const requestUrl = new URL("https://request.example/current");

    function stubRuntime() {
        vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
        vi.stubGlobal("useRequestURL", () => requestUrl);
    }

    it("prefers the configured public site origin", () => {
        stubRuntime();

        const seo = pageSeo({ title: "Rules", path: "/rules" });

        expect(seo.link).toEqual([{ rel: "canonical", href: "https://config.example/rules" }]);
    });

    it("falls back to the request origin when no configured origin exists", () => {
        stubRuntime();
        const original = runtimeConfig.public.siteOrigin;
        runtimeConfig.public.siteOrigin = "";
        try {
            const seo = pageSeo({ title: "FAQ", path: "/faq" });
            expect(seo.link).toEqual([{ rel: "canonical", href: "https://request.example/faq" }]);
        } finally {
            runtimeConfig.public.siteOrigin = original;
        }
    });

    it("uses an explicit options origin before any runtime value", () => {
        stubRuntime();

        const seo = pageSeo({
            title: "Contact",
            path: "/contact",
            origin: "https://explicit.example",
        });

        expect(seo.link).toEqual([{ rel: "canonical", href: "https://explicit.example/contact" }]);
    });
});
