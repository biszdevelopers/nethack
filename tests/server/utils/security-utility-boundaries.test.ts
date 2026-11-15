import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";
import { validateExternalUrl } from "~~/server/utils/url-validation";

describe("external URL address policy boundaries", () => {
    it.each([
        "100.64.0.1",
        "100.127.255.254",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "198.18.0.1",
        "198.19.255.254",
        "198.51.100.1",
        "203.0.113.1",
        "240.0.0.1",
        "255.255.255.255",
    ])("rejects non-public IPv4 address %s", (address) => {
        expect(() => validateExternalUrl(`https://${address}`)).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it.each(["[2001::1]", "[2001:db8::1]", "[2002::1]", "[3fff::1]"])(
        "rejects reserved or documentation IPv6 address %s",
        (address) => {
            expect(() => validateExternalUrl(`https://${address}`)).toThrow(
                "Private or loopback URLs are not allowed",
            );
        },
    );

    it("allows public addresses immediately beside blocked IPv4 ranges", () => {
        expect(validateExternalUrl("https://100.63.255.255").hostname).toBe("100.63.255.255");
        expect(validateExternalUrl("https://100.128.0.1").hostname).toBe("100.128.0.1");
        expect(validateExternalUrl("https://198.20.0.1").hostname).toBe("198.20.0.1");
    });
});

describe("same-origin request source fallbacks", () => {
    let enforceSameOriginCookieRequest: (event: any) => void;

    beforeAll(async () => {
        setupNitroGlobals();
        enforceSameOriginCookieRequest = (await import("~~/server/utils/request-security"))
            .enforceSameOriginCookieRequest;
        vi.stubGlobal("getHeader", (event: any, name: string) => {
            const headers = event.node.req.headers as Record<string, string | undefined>;
            return headers[name.toLowerCase()];
        });
    });

    afterEach(() => vi.unstubAllEnvs());

    const eventFor = (headers: Record<string, string> = {}, encrypted = true) => ({
        node: { req: { headers, socket: { encrypted } } },
    });

    it("uses an exact same-origin Referer when Origin is absent", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ referer: "https://portal.example/team/1", host: "portal.example" }),
            ),
        ).not.toThrow();
    });

    it("rejects a malformed Origin even when Referer looks valid", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({
                    origin: "https://portal.example.evil.invalid",
                    referer: "https://portal.example/team/1",
                }),
            ),
        ).toThrow("Cross-site request rejected");
    });

    it("derives the origin from Host and the socket when no public origin is configured", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "https://portal.example" }, true),
            ),
        ).not.toThrow();
        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "http://portal.example" }, false),
            ),
        ).not.toThrow();
    });

    it("honors the trusted forwarded protocol when deriving the request origin", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({
                    host: "portal.example",
                    origin: "https://portal.example",
                    "x-forwarded-proto": "https, http",
                }),
            ),
        ).not.toThrow();
    });
});
