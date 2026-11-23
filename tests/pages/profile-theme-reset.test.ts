import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "profile.vue"),
    "utf-8",
);

describe("profile theme removal", () => {
    it("clears the pending upload before removing the stored theme", () => {
        const removal = source.slice(
            source.indexOf("async function removeProfileTheme"),
            source.indexOf("async function onSubmitName"),
        );
        const clear = source.slice(
            source.indexOf("function clearPendingTheme"),
            source.indexOf("async function removeProfileTheme"),
        );

        expect(removal).toContain("clearPendingTheme();");
        expect(clear).toContain("state.profile_theme_image = undefined");
    });

    it("clears the pending upload after a successful save with an image", () => {
        const submit = source.slice(source.indexOf("async function onSubmitName"));

        expect(submit).toContain("clearPendingTheme();");
    });
});
