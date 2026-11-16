import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "SafeComark.vue"),
    "utf-8",
);

describe("SafeComark.vue", () => {
    it("imports the safe link renderer used by its component map", () => {
        expect(source).toContain('import SafeLink from "~/components/SafeLink.vue"');
        expect(source).toContain("const safeComponents = { a: SafeLink }");
    });

    it("renders the registered Markdown component with its value prop", () => {
        expect(source).toContain("const markdown = computed");
        expect(source).toContain("<Markdown");
        expect(source).toContain(':value="markdown"');
        expect(source).not.toContain("<Comark");
    });

    it("keeps raw HTML disabled and preserves single line breaks", () => {
        expect(source).toContain("registerDefaultPlugins: false");
        expect(source).toContain("const safePlugins = [breaks()]");
        expect(source).toContain(':plugins="safePlugins"');
    });
});
