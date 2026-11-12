import { describe, expect, it } from "vitest";
import { parseNuxtIconCollections } from "../../scripts/nuxt-icon-collection-parser.mjs";

const collections = [
    {
        prefix: "lucide",
        icons: {
            check: {
                body: '<path d="M1 1"/>',
            },
        },
    },
];

describe("parseNuxtIconCollections", () => {
    it.each([
        ["formatted declaration", "const collections = JSON.parse"],
        ["compact declaration", "const collections=JSON.parse"],
        ["renamed declaration", "const a=JSON.parse"],
    ])("reads JSON.parse collection payloads from a %s", (_name, declaration) => {
        const encodedCollections = JSON.stringify(JSON.stringify(collections));
        const source = `export function init(){${declaration}(${encodedCollections})}`;

        expect(parseNuxtIconCollections(source)).toEqual(collections);
    });

    it("skips unrelated JSON.parse calls and finds the icon collection payload", () => {
        const encodedOtherArray = JSON.stringify(JSON.stringify(["unrelated"]));
        const encodedCollections = JSON.stringify(JSON.stringify(collections));
        const source = `JSON.parse(${encodedOtherArray}); JSON.parse(${encodedCollections});`;

        expect(parseNuxtIconCollections(source)).toEqual(collections);
    });

    it("rejects bundles without an icon collection payload", () => {
        expect(() =>
            parseNuxtIconCollections("export function init(){const collections=[]}"),
        ).toThrow("serialized icon collection array");
    });
});
