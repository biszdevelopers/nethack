import deepmerge from "../../vendor/deepmerge-safe/index.mjs";
import { describe, expect, it } from "vitest";

describe("the local deepmerge replacement", () => {
    it("preserves prototype-looking keys as data without prototype pollution", () => {
        const source = JSON.parse('{"__proto__":{"polluted":"yes"}}');
        const result = deepmerge({}, source);

        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.prototype).not.toHaveProperty("polluted");
        expect(Object.getOwnPropertyDescriptor(result, "__proto__")).toMatchObject({
            enumerable: true,
            value: { polluted: "yes" },
        });
    });

    it("deeply clones and merges default plain objects", () => {
        const target = { options: { values: ["default"] } };
        const result = deepmerge(target, { options: { enabled: true, values: ["override"] } });

        expect(result).toEqual({
            options: { enabled: true, values: ["default", "override"] },
        });
        expect(result).not.toBe(target);
        expect(result.options).not.toBe(target.options);
    });
});
