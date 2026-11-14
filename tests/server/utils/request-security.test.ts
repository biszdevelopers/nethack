import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

describe("same-origin checks for cookie-authenticated mutations", () => {
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

    function eventFor(headers: Record<string, string> = {}) {
        return { node: { req: { headers, socket: { encrypted: true } } } };
    }

    it("accepts cookie requests with an exact configured origin", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example/season");
        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "https://portal.example" }),
            ),
        ).not.toThrow();
    });

    it("rejects cross-site or origin-less cookie requests", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");
        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "https://evil.example" }),
            ),
        ).toThrow("Cross-site request rejected");
        expect(() => enforceSameOriginCookieRequest(eventFor({ host: "portal.example" }))).toThrow(
            "Cross-site request rejected",
        );
    });

    it("rejects requests marked as cross-site even when their Origin header matches", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");
        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({
                    host: "portal.example",
                    origin: "https://portal.example",
                    "sec-fetch-site": "cross-site",
                }),
            ),
        ).toThrow("Cross-site request rejected");
    });

    it("requires no browser-origin headers when a bearer credential is supplied", () => {
        expect(() =>
            enforceSameOriginCookieRequest(eventFor({ authorization: "Bearer test-token" })),
        ).not.toThrow();
    });
});
