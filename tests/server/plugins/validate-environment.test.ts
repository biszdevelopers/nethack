import { describe, expect, it } from "vitest";
import {
    isValidE2ELoopbackOrigin,
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

describe("isolated E2E loopback origin validation", () => {
    it("accepts only the exact numeric loopback host and configured test port", () => {
        expect(
            isValidE2ELoopbackOrigin("http://127.0.0.1:3005", "127.0.0.1", "3005", undefined),
        ).toBe(true);
    });

    it.each([
        ["http://localhost:3005", "127.0.0.1", "3005"],
        ["http://127.0.0.2:3005", "127.0.0.1", "3005"],
        ["https://127.0.0.1:3005", "127.0.0.1", "3005"],
        ["http://127.0.0.1:3006", "127.0.0.1", "3005"],
        ["http://user@127.0.0.1:3005", "127.0.0.1", "3005"],
        ["http://127.0.0.1:3005/path", "127.0.0.1", "3005"],
        ["http://127.0.0.1:3005?next=/", "127.0.0.1", "3005"],
        ["http://127.0.0.1:3005", "0.0.0.0", "3005"],
        ["http://127.0.0.1:3005", "127.0.0.1", "0"],
        ["http://127.0.0.1:3005", "127.0.0.1", "65536"],
        ["http://127.0.0.1:3005", "127.0.0.1", "3005", "/tmp/basishacks.sock"],
        [undefined, "127.0.0.1", "3005"],
    ] as const)("rejects unsafe E2E origin settings: %j", (origin, host, port, unixSocket) => {
        expect(isValidE2ELoopbackOrigin(origin, host, port, unixSocket)).toBe(false);
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
