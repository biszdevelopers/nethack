import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");

describe("targeted accessibility regressions", () => {
    it.each(["default", "dashboard"])(
        "provides a skip link and main landmark in the %s layout",
        (layout) => {
            const source = readSource("app", "layouts", `${layout}.vue`);

            expect(source).toContain('href="#main-content"');
            expect(source).toContain("Skip to main content");
            expect(source).toContain('<UMain id="main-content" tabindex="-1">');
        },
    );

    it("gives mobile dashboard navigation links a 44px target and visible focus", () => {
        const source = readSource("app", "layouts", "dashboard.vue");

        expect(source).toContain(
            'class="flex min-h-11 items-center gap-2 px-3 py-2 no-underline focus-visible:outline-2',
        );
    });

    it("labels every icon-only team action and gives it a 44px target", () => {
        const source = readSource("app", "components", "TeamForm.vue");

        expect(source).toContain('aria-label="Rename team"');
        expect(source).toContain('aria-label="Add team member"');
        expect(source).toContain("? 'Leave team'");
        expect(source).toContain("`Remove ${user.name || user.email} from team`");
        expect(source.match(/class="min-h-11 min-w-11"/g)).toHaveLength(3);
    });

    it("labels the profile control for both signed-in and signed-out states", () => {
        const source = readSource("app", "components", "RoleHeader.vue");

        expect(source).toContain(":aria-label=\"userRef ? 'Open your profile' : 'Sign in'\"");
    });

    it("associates every season switch with its visible label and touch target", () => {
        const source = readSource("app", "pages", "developers", "season.vue");
        const labels = [
            "Voting Enabled",
            "Judging Open",
            "Results Published",
            "Show Scores",
            "Show Ranking",
        ];

        for (const label of labels) {
            expect(source).toContain(`label="${label}"`);
        }
        expect(source.match(/:ui="\{ label: 'min-h-11 cursor-pointer py-3' \}"/g)).toHaveLength(5);
    });

    it("disables score animation when reduced motion is requested", () => {
        const source = readSource("app", "components", "ScoreCard.vue");

        expect(source).toContain("@media (prefers-reduced-motion: reduce)");
        expect(source).toContain(".metallic-gold,");
        expect(source).toContain(".rainbow-once {\n        background-position: 100% center;");
    });

    it("uses a logical heading hierarchy for results", () => {
        const source = readSource("app", "pages", "dashboard", "results.vue");

        expect(source).toContain(
            '<h1 class="text-3xl sm:text-4xl bold text-primary glow">Results</h1>',
        );
        expect(source.match(/<h2 /g)).toHaveLength(2);
        expect(source).not.toContain("<h3");
    });

    it("uses toggle semantics without an incomplete tabpanel pattern", () => {
        const source = readSource("app", "components", "admin", "RubricDefinitionEditor.vue");

        expect(source).toContain('role="group" aria-label="Rubric tracks"');
        expect(source).toContain(':aria-pressed="id === selectedTrackId"');
        expect(source).toContain('role="region"');
        expect(source).not.toContain('role="tabpanel"');
    });
});
