import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pagesDirectory = resolve(import.meta.dirname, "..", "..", "app", "pages", "showcase");
const indexSource = readFileSync(resolve(pagesDirectory, "index.vue"), "utf-8");
const archiveIndexSource = readFileSync(
    resolve(
        import.meta.dirname,
        "..",
        "..",
        "app",
        "components",
        "showcase",
        "ShowcaseSeasonArchive.vue",
    ),
    "utf-8",
);
const seasonArchiveSource = readFileSync(
    resolve(
        import.meta.dirname,
        "..",
        "..",
        "app",
        "components",
        "showcase",
        "SeasonProjectArchive.vue",
    ),
    "utf-8",
);

describe("showcase routes", () => {
    it("keeps each season showcase under /showcase", () => {
        expect(existsSync(resolve(pagesDirectory, "beneath-the-surface.vue"))).toBe(true);
        expect(existsSync(resolve(pagesDirectory, "signal.vue"))).toBe(true);
    });

    it("features Beneath the Surface before Signal on the showcase index", () => {
        const featuredPosition = indexSource.indexOf('to="/showcase/beneath-the-surface"');
        const previousPosition = indexSource.indexOf('to="/showcase/signal"');

        expect(featuredPosition).toBeGreaterThan(-1);
        expect(previousPosition).toBeGreaterThan(featuredPosition);
    });

    it("links to both season showcase routes", () => {
        expect(indexSource).toContain('to="/showcase/beneath-the-surface"');
        expect(indexSource).toContain('to="/showcase/signal"');
    });

    it("exposes archived seasons and their project descriptions", () => {
        expect(indexSource).toContain("<ShowcaseSeasonArchive />");
        expect(existsSync(resolve(pagesDirectory, "seasons", "[id].vue"))).toBe(true);
        expect(archiveIndexSource).toContain('"/api/seasons"');
        expect(archiveIndexSource).toContain('season.status !== "not_started"');
        expect(archiveIndexSource).toContain("/showcase/seasons/${season.id}");
        expect(seasonArchiveSource).toContain("/api/teams?season_id=${props.seasonId}");
        expect(seasonArchiveSource).toContain("team.project.description");
    });
});
