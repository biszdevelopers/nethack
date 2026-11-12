import { describe, expect, it } from "vitest";
import {
    isValidProductionOrigin,
    isValidTrustedProxyHops,
} from "~~/server/utils/environment-validation";

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

describe("trusted proxy hop validation", () => {
    it.each([undefined, "", "0", "1", "10"])("accepts a supported hop count: %s", (value) => {
        expect(isValidTrustedProxyHops(value)).toBe(true);
    });

    it.each(["-1", "1.5", "11", "9007199254740992", "many"])(
        "rejects an unsupported hop count: %s",
        (value) => {
            expect(isValidTrustedProxyHops(value)).toBe(false);
        },
    );
});
