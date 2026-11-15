import { describe, expect, it } from "vitest";
import deepmerge from "../../vendor/deepmerge-safe/index.mjs";

describe("safe deep merge fallback behavior", () => {
    it("replaces non-plain sources without merging into a plain target", () => {
        const replacement = new Date("2026-01-01T00:00:00.000Z");
        const result = deepmerge({ keep: true }, replacement);

        expect(result).toBe(replacement);
    });

    it("clones a plain source when the target is not a plain object", () => {
        const source = Object.assign(Object.create(null), { settings: { enabled: true } });
        const result = deepmerge(new Date("2026-01-01T00:00:00.000Z"), source);

        expect(result).toEqual(source);
        expect(result).not.toBe(source);
        expect(Object.getPrototypeOf(result)).toBeNull();
        expect(result.settings).not.toBe(source.settings);
    });
});
