import { describe, expect, it } from "vitest";
import { isSafeUrl, safeUrl } from "../../app/utils/url-validation";

describe("frontend URL validation", () => {
    it.each(["/dashboard", "/dashboard?tab=team", "/rules#eligibility"])(
        "allows a same-origin path: %s",
        (url) => {
            expect(isSafeUrl(url)).toBe(true);
            expect(safeUrl(url)).toBe(url);
        },
    );

    it.each(["//evil.example/path", "/\\\\evil.example/path", "/\\\\@evil.example"])(
        "rejects a path that the browser could resolve off-origin: %s",
        (url) => {
            expect(isSafeUrl(url)).toBe(false);
            expect(safeUrl(url)).toBeUndefined();
        },
    );

    it.each(["https://example.com/project", "http://example.com/project"])(
        "allows an absolute web URL: %s",
        (url) => expect(isSafeUrl(url)).toBe(true),
    );

    it.each([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://user:secret@example.com/project",
    ])("rejects unsafe or ambiguous URL: %s", (url) => {
        expect(isSafeUrl(url)).toBe(false);
        expect(safeUrl(url)).toBeUndefined();
    });
});
