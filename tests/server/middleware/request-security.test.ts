import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

describe("request security middleware", () => {
    let middleware: (event: any) => void;

    beforeAll(async () => {
        setupNitroGlobals();
        middleware = (await import("~~/server/middleware/00.request-security")).default;
        vi.stubGlobal("getHeader", (event: any, name: string) => {
            const headers = event.node.req.headers as Record<string, string | undefined>;
            return headers[name.toLowerCase()];
        });
    });

    afterEach(() => vi.unstubAllEnvs());

    const eventFor = (
        method: string,
        headers: Record<string, string> = {},
        path = "/api/test",
    ) => ({
        path,
        method,
        node: { req: { headers, socket: { encrypted: true } } },
    });

    it("rejects cross-origin cookie-authenticated state changes globally", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            middleware(
                eventFor("PATCH", {
                    host: "portal.example",
                    origin: "https://evil.example",
                }),
            ),
        ).toThrow("Cross-site request rejected");
    });

    it("allows same-origin browser changes and authenticated service requests", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            middleware(
                eventFor("POST", {
                    host: "portal.example",
                    origin: "https://portal.example",
                }),
            ),
        ).not.toThrow();
        expect(() =>
            middleware(eventFor("DELETE", { authorization: "Bearer service-token" })),
        ).not.toThrow();
    });

    it("does not require browser origin headers on safe methods", () => {
        expect(() => middleware(eventFor("GET"))).not.toThrow();
        expect(() => middleware(eventFor("OPTIONS"))).not.toThrow();
    });

    it("allows server-to-server Graph webhook posts without weakening browser mutations", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() => middleware(eventFor("POST", {}, "/api/_webhooks/update"))).not.toThrow();
        expect(() => middleware(eventFor("POST", {}, "/api/_webhooks/lifecycle"))).not.toThrow();
        expect(() => middleware(eventFor("POST", {}, "/api/_webhooks/other"))).toThrow(
            "Cross-site request rejected",
        );
    });
});
