import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readPage = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", "app", ...segments), "utf8");

describe("read-only debug file listings", () => {
    const pages = [
        ["admin debug page", readPage("pages", "debug.vue")],
        ["developer files page", readPage("pages", "developers", "debug.vue")],
    ] as const;

    it.each(pages)("loads and paginates outstanding references on the %s", (_name, source) => {
        expect(source).toContain('"/api/assets/references"');
        expect(source).toContain("query: { page, page_size: referencePageSize }");
        expect(source).toContain("onMounted(refreshFiles)");
        expect(source).toContain('v-for="reference in references"');
        expect(source).toContain(
            "Page {{ referencePage }} of {{ referencePagination.total_pages }}",
        );
        expect(source).toContain("loadReferences(referencePage + 1)");
    });

    it.each(pages)(
        "keeps existing links without upload or release controls on the %s",
        (_name, source) => {
            expect(source).toContain('"/api/debug/files"');
            expect(source).toContain("/assets/uploads/${name}");
            expect(source).toContain("/userast/${name}");
            expect(source).not.toContain("/api/debug/upload");
            expect(source).not.toContain("releaseReference");
            expect(source).not.toContain('type="file"');
        },
    );
});
