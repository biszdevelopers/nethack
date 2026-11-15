import { afterEach, describe, expect, it } from "vitest";
import { getPublicOrigin } from "~~/server/utils/oauth2";

const originalOrigin = process.env.CURRENT_URL_ORIGIN;

afterEach(() => {
    if (originalOrigin === undefined) delete process.env.CURRENT_URL_ORIGIN;
    else process.env.CURRENT_URL_ORIGIN = originalOrigin;
});

describe("public application origin", () => {
    it.each([undefined, ""])("uses the local development origin when unset: %s", (origin) => {
        if (origin === undefined) delete process.env.CURRENT_URL_ORIGIN;
        else process.env.CURRENT_URL_ORIGIN = origin;

        expect(getPublicOrigin()).toBe("http://localhost:3000");
    });

    it("removes trailing slashes from a configured public origin", () => {
        process.env.CURRENT_URL_ORIGIN = "https://basishacks.example///";

        expect(getPublicOrigin()).toBe("https://basishacks.example");
    });
});
