import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { setupNitroGlobals } from "../api/helpers";

const SERVER_TO_SERVER_POST_PATHS = new Set([
    "/api/_webhooks/update",
    "/api/_webhooks/lifecycle",
    "/api/auth/basis/backchannel",
]);

let middleware: (event: any) => void;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("getHeader", (event: any, name: string) => {
        const headers = event.node?.req?.headers ?? {};
        return headers[name.toLowerCase()];
    });
    middleware = (await import("~~/server/middleware/00.request-security")).default;
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function event(method: string, path = "/api/teams/1", headers: Record<string, string> = {}) {
    return {
        method,
        path,
        node: { req: { headers, socket: { encrypted: true } } },
    };
}

function expectRejected(method: string, headers: Record<string, string> = {}, path?: string) {
    expect(() => middleware(event(method, path, headers))).toThrow("Cross-site request rejected");
}

describe("same-origin enforcement for mutating routes", () => {
    it("rejects a missing or foreign Origin on cookie requests", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expectRejected("POST", { host: "portal.example" });
        expectRejected("POST", { host: "portal.example", origin: "https://evil.example" });
        expectRejected("PATCH", { host: "portal.example", origin: "https://evil.example" });
        expectRejected("PUT", { host: "portal.example", origin: "https://evil.example" });
        expectRejected("DELETE", { host: "portal.example", origin: "https://evil.example" });
    });

    it("rejects a foreign Referer when Origin is absent", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expectRejected("POST", {
            host: "portal.example",
            referer: "https://evil.example/attack",
        });
    });

    it("accepts a same-origin Referer when Origin is absent", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            middleware(
                event("POST", "/api/teams/1", {
                    host: "portal.example",
                    referer: "https://portal.example/dashboard",
                }),
            ),
        ).not.toThrow();
    });

    it("rejects a request marked cross-site even with a matching Origin", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expectRejected("POST", {
            host: "portal.example",
            origin: "https://portal.example",
            "sec-fetch-site": "cross-site",
        });
    });

    it("accepts same-origin and same-site browser requests", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        for (const fetchSite of ["same-origin", "same-site", "none"]) {
            expect(() =>
                middleware(
                    event("POST", "/api/teams/1", {
                        host: "portal.example",
                        origin: "https://portal.example",
                        "sec-fetch-site": fetchSite,
                    }),
                ),
            ).not.toThrow();
        }
    });

    it("requires no browser origin headers for bearer clients", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");

        expect(() =>
            middleware(event("POST", "/api/teams/1", { authorization: "Bearer opaque-token" })),
        ).not.toThrow();
    });

    it("leaves safe methods alone", () => {
        for (const method of ["GET", "HEAD", "OPTIONS"]) {
            expect(() => middleware(event(method))).not.toThrow();
        }
    });

    it("only bypasses the documented server-to-server POST paths", () => {
        expect(() => middleware(event("POST", "/api/auth/basis/backchannel"))).not.toThrow();
        expectRejected("POST", {}, "/api/teams/1");
        expectRejected("PATCH", {}, "/api/auth/basis/backchannel");
    });
});

describe("mutating route inventory", () => {
    const apiDir = resolve(import.meta.dirname, "..", "..", "server", "api");

    function routeFiles(dir: string): string[] {
        return readdirSync(dir).flatMap((name) => {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) return routeFiles(full);
            return name.endsWith(".ts") ? [relative(apiDir, full).replace(/\\/g, "/")] : [];
        });
    }

    it("rejects cross-site cookie requests for every mutating route family", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://portal.example");
        const mutating = routeFiles(apiDir).filter((file) =>
            /\.(post|patch|put|delete)\.ts$/.test(file),
        );
        const bypassed = mutating.filter((file) => {
            const path = `/api/${file.replace(/\.(post|patch|put|delete)\.ts$/, "")}`;
            return SERVER_TO_SERVER_POST_PATHS.has(path);
        });

        expect(mutating.length).toBeGreaterThan(30);
        for (const file of mutating) {
            if (bypassed.includes(file)) continue;
            const path = `/api/${file.replace(/\.(post|patch|put|delete)\.ts$/, "")}`;
            expect(
                () =>
                    middleware(
                        event("POST", path, {
                            host: "portal.example",
                            origin: "https://evil.example",
                        }),
                    ),
                file,
            ).toThrow("Cross-site request rejected");
        }
    });

    it("keeps the server-to-server bypass list minimal", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "middleware",
                "00.request-security.ts",
            ),
            "utf8",
        );
        const paths = [...source.matchAll(/"(\/api\/[^"]+)"/g)].map((match) => match[1]!);

        expect(paths).toContain("/api/auth/basis/backchannel");
        expect(paths.filter((path) => !SERVER_TO_SERVER_POST_PATHS.has(path))).toEqual([]);
    });
});
