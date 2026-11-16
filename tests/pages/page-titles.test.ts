import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const pagesDir = resolve(import.meta.dirname, "..", "..", "app", "pages");

function pageFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return pageFiles(full);
        return name.endsWith(".vue") ? [relative(pagesDir, full).replace(/\\/g, "/")] : [];
    });
}

/** Pages that never render content and therefore need no title. */
const TITLELESS_PAGES = new Set(["user/index.vue"]);

const files = pageFiles(pagesDir).sort();

describe("page document titles", () => {
    it("finds every page", () => {
        expect(files.length).toBeGreaterThan(20);
    });

    it("gives every rendered page a document title", () => {
        const missing = files.filter((file) => {
            if (TITLELESS_PAGES.has(file)) return false;
            const source = readFileSync(join(pagesDir, file), "utf8");
            return !/useHead\s*\(/.test(source) && !/\btitle:\s*[`"']/.test(source);
        });

        expect(missing).toEqual([]);
    });

    it("keeps the titleless-page list honest", () => {
        for (const file of TITLELESS_PAGES) {
            expect(files, `${file} should still exist`).toContain(file);
        }
    });
});
