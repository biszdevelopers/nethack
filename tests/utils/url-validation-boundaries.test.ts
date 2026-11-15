import { describe, expect, it } from "vitest";
import { isSafeUrl, safeUrl } from "../../app/utils/url-validation";

describe("frontend URL validation boundaries", () => {
    it("rejects empty input and preserves safeUrl's nullish and empty handling", () => {
        expect(isSafeUrl("")).toBe(false);
        expect(safeUrl(null)).toBeUndefined();
        expect(safeUrl(undefined)).toBeUndefined();
        expect(safeUrl("")).toBeUndefined();
    });

    it("fails closed when absolute URL parsing rejects malformed authority syntax", () => {
        expect(isSafeUrl("http://[")).toBe(false);
        expect(safeUrl("http://[")).toBeUndefined();
    });

    it("fails closed if URL coercion throws for an out-of-contract runtime value", () => {
        const value = {
            startsWith: (prefix: string) => prefix === "/",
            [Symbol.toPrimitive]: () => {
                throw new TypeError("cannot convert runtime value to a URL");
            },
        } as unknown as string;

        expect(isSafeUrl(value)).toBe(false);
    });
});
