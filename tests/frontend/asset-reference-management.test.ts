import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readPage = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", "app", ...segments), "utf8");

describe("debug permalink reference management", () => {
    const pages = [
        ["admin debug page", readPage("pages", "debug.vue")],
        ["developer files page", readPage("pages", "developers", "debug.vue")],
    ] as const;

    it.each(pages)("loads and paginates outstanding references on the %s", (_name, source) => {
        expect(source).toContain('"/api/assets/references"');
        expect(source).toContain("query: { page, page_size: referencePageSize }");
        expect(source).toContain("onMounted(refreshUploads)");
        expect(source).toContain('v-for="reference in references"');
        expect(source).toContain(
            "Page {{ referencePage }} of {{ referencePagination.total_pages }}",
        );
        expect(source).toContain("loadReferences(referencePage + 1)");
    });

    it.each(pages)(
        "releases any listed reference and refreshes after upload on the %s",
        (_name, source) => {
            expect(source).toContain("releaseReference(reference.id)");
            expect(source).toContain("encodeURIComponent(id)");
            expect(source).toContain("await refreshUploads(true)");
            expect(source).toContain("/api/assets/references/${encodeURIComponent(id)}");
            expect(source).toContain("No active permalink references.");
        },
    );
});
