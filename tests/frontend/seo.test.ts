import { describe, expect, it } from "vitest";
import { buildPageSeo, resolveSeoUrl } from "~/app/utils/seo";

describe("buildPageSeo", () => {
    it("builds a canonical URL and matching Open Graph metadata", () => {
        const head = buildPageSeo(
            {
                title: "Projects | nethack",
                description: "Browse submitted projects.",
                path: "/projects",
            },
            "https://hack.example.test",
        );

        expect(head.title).toBe("Projects | nethack");
        expect(head.link).toEqual([
            { rel: "canonical", href: "https://hack.example.test/projects" },
        ]);
        expect(head.meta).toContainEqual({
            property: "og:url",
            content: "https://hack.example.test/projects",
        });
        expect(head.meta).toContainEqual({
            name: "description",
            content: "Browse submitted projects.",
        });
        expect(head.meta).toContainEqual({
            property: "og:description",
            content: "Browse submitted projects.",
        });
        expect(head.meta).toContainEqual({ name: "twitter:card", content: "summary" });
    });

    it("adds robots and image tags only when they are supplied", () => {
        const hidden = buildPageSeo(
            {
                title: "Hidden",
                path: "/projects",
                robots: "noindex, nofollow",
            },
            "https://hack.example.test",
        );

        expect(hidden.meta).toContainEqual({
            name: "robots",
            content: "noindex, nofollow",
        });
        expect(hidden.meta.some((entry) => entry.property === "og:image")).toBe(false);

        const withImage = buildPageSeo(
            {
                title: "Shown",
                path: "/results",
                image: "/social.png",
            },
            "https://hack.example.test",
        );

        expect(withImage.meta).toContainEqual({
            property: "og:image",
            content: "https://hack.example.test/social.png",
        });
        expect(withImage.meta).toContainEqual({
            name: "twitter:card",
            content: "summary_large_image",
        });
    });

    it("keeps relative URLs usable when no origin is configured", () => {
        const head = buildPageSeo({ title: "Rules", path: "/rules" });

        expect(head.link[0]).toEqual({ rel: "canonical", href: "/rules" });
        expect(head.meta).toContainEqual({ property: "og:url", content: "/rules" });
    });
});

describe("resolveSeoUrl", () => {
    it("leaves absolute values untouched and resolves relative paths", () => {
        expect(resolveSeoUrl("https://example.test/a", "https://hack.example.test")).toBe(
            "https://example.test/a",
        );
        expect(resolveSeoUrl("/faq", "https://hack.example.test")).toBe(
            "https://hack.example.test/faq",
        );
        expect(resolveSeoUrl("/faq")).toBe("/faq");
    });
});
