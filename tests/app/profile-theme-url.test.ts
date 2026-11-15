import { describe, expect, it } from "vitest";
import { getProfileThemeUrl } from "~~/app/utils/profile-theme-url";

describe("profile theme URL", () => {
    it("returns sanitized external URLs and legacy relative asset paths", () => {
        expect(getProfileThemeUrl({ mode: "url", value: "https://cdn.example.test/a.png" })).toBe(
            "https://cdn.example.test/a.png",
        );
        expect(getProfileThemeUrl({ mode: "url", value: "profiles/a b.png" })).toBe(
            "/userast/profiles/a%20b.png",
        );
    });

    it("returns undefined for non-URL themes or empty values", () => {
        expect(getProfileThemeUrl({ mode: "emoji", value: "🥳" })).toBeUndefined();
        expect(getProfileThemeUrl({ mode: "url", value: "" })).toBeUndefined();
        expect(getProfileThemeUrl(null)).toBeUndefined();
    });
});
