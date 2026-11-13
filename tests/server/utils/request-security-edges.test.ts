import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { enforceSameOriginCookieRequest } from "~~/server/utils/request-security";

describe("same-origin validation edge cases", () => {
    beforeAll(() => {
        vi.stubGlobal(
            "getHeader",
            (event: any, name: string) => event.node.req.headers[name.toLowerCase()],
        );
        vi.stubGlobal("createError", (data: any) =>
            Object.assign(new Error(data.statusMessage ?? data.message), data),
        );
    });

    afterEach(() => vi.unstubAllEnvs());

    const eventFor = (headers: Record<string, string> = {}, socket?: { encrypted?: boolean }) => ({
        node: { req: { headers, ...(socket ? { socket } : {}) } },
    });

    const expectDenied = (action: () => void) => {
        let error: unknown;
        try {
            action();
        } catch (caught) {
            error = caught;
        }
        expect(error).toMatchObject({
            statusCode: 403,
            statusMessage: "Cross-site request rejected",
        });
    };

    it("derives an origin from the first forwarded protocol and host when no origin is configured", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor(
                    {
                        host: "portal.example",
                        "x-forwarded-proto": " https , http",
                        referer: "https://portal.example/results",
                        "sec-fetch-site": "same-origin",
                    },
                    { encrypted: false },
                ),
            ),
        ).not.toThrow();
    });

    it("uses the plain HTTP fallback when no forwarded protocol or TLS socket exists", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");

        expect(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "http://portal.example" }),
            ),
        ).not.toThrow();
    });

    it("rejects malformed origin and referer values", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expectDenied(() =>
            enforceSameOriginCookieRequest(
                eventFor({ origin: "http://[", referer: "https://portal.example/" }),
            ),
        );
        expectDenied(() => enforceSameOriginCookieRequest(eventFor({ referer: "not a URL" })));
    });

    it("rejects an invalid configured origin or invalid host used to derive the origin", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "http://[");
        expectDenied(() =>
            enforceSameOriginCookieRequest(
                eventFor({ host: "portal.example", origin: "https://portal.example" }),
            ),
        );

        vi.stubEnv("CURRENT_URL_ORIGIN", "");
        expectDenied(() =>
            enforceSameOriginCookieRequest(eventFor({ host: "[", origin: "http://[" })),
        );

        expectDenied(() =>
            enforceSameOriginCookieRequest(eventFor({ origin: "https://portal.example" })),
        );
    });

    it("prefers Origin over a matching Referer and compares fetch metadata case-insensitively", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expectDenied(() =>
            enforceSameOriginCookieRequest(
                eventFor({
                    origin: "https://attacker.example",
                    referer: "https://portal.example/",
                }),
            ),
        );

        expectDenied(() =>
            enforceSameOriginCookieRequest(
                eventFor({
                    origin: "https://portal.example",
                    "sec-fetch-site": "Cross-Site",
                }),
            ),
        );
    });
});
