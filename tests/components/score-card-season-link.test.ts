import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scoreCardSource = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "ScoreCard.vue"),
    "utf-8",
);

describe("ScoreCard season details link", () => {
    it("opens the team's season page with a mobile-sized target", () => {
        expect(scoreCardSource).toContain('v-if="team.season_id"');
        expect(scoreCardSource).toContain(':to="`/seasons/${team.season_id}`"');
        expect(scoreCardSource).toContain(
            'class="inline-flex min-h-11 items-center gap-1 text-xs"',
        );
        expect(scoreCardSource).toContain("See Season Details");
        expect(scoreCardSource).not.toContain('href="#"');
        expect(scoreCardSource).not.toContain('target="_blank" external');
    });
});
