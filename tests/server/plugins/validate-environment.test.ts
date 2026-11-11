import { describe, expect, it } from "vitest";
import { isValidProductionOrigin } from "~~/server/utils/environment-validation";

describe("production public origin validation", () => {
    it.each(["https://basishacks.example", "https://basishacks.example:8443"])(
        "accepts a public HTTPS origin: %s",
        (origin) => {
            expect(isValidProductionOrigin(origin)).toBe(true);
        },
    );

    it.each([
        undefined,
        "",
        "http://basishacks.example",
        "https://basishacks.example/path",
        "https://user:secret@basishacks.example",
        "https://basishacks.example?next=/",
        "not a URL",
    ])("rejects an unsafe or malformed production origin: %s", (origin) => {
        expect(isValidProductionOrigin(origin)).toBe(false);
    });
});
