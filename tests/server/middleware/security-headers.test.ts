import { describe, it, expect, vi, beforeAll } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

describe("security headers middleware", () => {
    let middleware: (event: any) => Promise<void>;

    beforeAll(async () => {
        setupNitroGlobals();
        // Route setHeader through to the mock response so we can inspect headers.
        vi.stubGlobal("setHeader", (event: any, name: string, value: string) => {
            event.node.res.setHeader(name, value);
        });
        middleware = (await import("~~/server/middleware/security-headers")).default;
    });

    function createMockEvent(url: string) {
        const headers: Record<string, string> = {};
        return {
            path: url.split("?", 1)[0],
            context: {},
            node: {
                req: { url },
                res: {
                    setHeader: vi.fn((name: string, value: string) => {
                        headers[name.toLowerCase()] = value;
                    }),
                    getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
                },
            },
        };
    }

    it("sets all required security headers on a sample API route", async () => {
        const event = createMockEvent("/api/seasons/active");
        await middleware(event);

        expect(event.node.res.getHeader("cache-control")).toBe("private, no-store");

        expect(event.node.res.setHeader).toHaveBeenCalledWith(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains; preload",
        );
        expect(event.node.res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
        expect(event.node.res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
        expect(event.node.res.setHeader).toHaveBeenCalledWith(
            "Referrer-Policy",
            "strict-origin-when-cross-origin",
        );
        expect(event.node.res.setHeader).toHaveBeenCalledWith(
            "Permissions-Policy",
            expect.stringContaining("camera=()"),
        );

        const cspCall = event.node.res.setHeader.mock.calls.find(
            ([name]: [string]) => name === "Content-Security-Policy",
        );
        expect(cspCall).toBeDefined();
        const csp = cspCall![1] as string;
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain(`script-src 'self' 'nonce-${event.context.cspNonce}'`);
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("font-src 'self'");
        expect(csp).toContain("img-src 'self' blob: data:");
        expect(csp).toContain("connect-src 'self'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("form-action 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
    });

    it("sets security headers on a sample page route", async () => {
        const event = createMockEvent("/dashboard");
        await middleware(event);

        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event.node.res.getHeader("x-content-type-options")).toBe("nosniff");
        expect(event.node.res.getHeader("cache-control")).toBeUndefined();

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
    });

    it("disables the expected permissions in Permissions-Policy", async () => {
        const event = createMockEvent("/");
        await middleware(event);

        const policy = event.node.res.getHeader("permissions-policy") as string;
        const disabled = [
            "camera=()",
            "microphone=()",
            "geolocation=()",
            "payment=()",
            "usb=()",
            "magnetometer=()",
            "gyroscope=()",
            "accelerometer=()",
            "autoplay=()",
            "encrypted-media=()",
            "picture-in-picture=()",
        ];
        for (const feature of disabled) {
            expect(policy).toContain(feature);
        }
    });

    // -----------------------------------------------------------------------
    // Individual header exact value checks (via getHeader)
    // -----------------------------------------------------------------------

    it("Strict-Transport-Security has the correct value", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        expect(event.node.res.getHeader("strict-transport-security")).toBe(
            "max-age=63072000; includeSubDomains; preload",
        );
    });

    it("X-Frame-Options has the correct value", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
    });

    it("X-Content-Type-Options has the correct value", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        expect(event.node.res.getHeader("x-content-type-options")).toBe("nosniff");
    });

    it("Referrer-Policy has the correct value", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        expect(event.node.res.getHeader("referrer-policy")).toBe("strict-origin-when-cross-origin");
    });

    it("Permissions-Policy is a non-empty string", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const policy = event.node.res.getHeader("permissions-policy") as string;
        expect(policy).toBeTruthy();
        expect(typeof policy).toBe("string");
        expect(policy.length).toBeGreaterThan(0);
    });

    it("Content-Security-Policy is a non-empty string", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toBeTruthy();
        expect(typeof csp).toBe("string");
        expect(csp.length).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // Individual Content-Security-Policy directive checks
    // -----------------------------------------------------------------------

    it("CSP contains default-src 'self'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("default-src 'self'");
    });

    it("CSP contains same-origin scripts and a response nonce", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain(`script-src 'self' 'nonce-${event.context.cspNonce}'`);
    });

    it("CSP contains style-src 'self' 'unsafe-inline'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    it("CSP contains font-src 'self'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("font-src 'self'");
    });

    it("CSP contains img-src 'self' blob: data:", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("img-src 'self' blob: data:");
    });

    it("CSP restricts connections to the same origin", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("connect-src 'self'");
    });

    it("CSP contains object-src 'none'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("object-src 'none'");
    });

    it("CSP contains base-uri 'self'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("base-uri 'self'");
    });

    it("CSP contains form-action 'self'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("form-action 'self'");
    });

    it("CSP contains frame-ancestors 'none'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).toContain("frame-ancestors 'none'");
    });

    // -----------------------------------------------------------------------
    // CSP safety checks
    // -----------------------------------------------------------------------

    it("CSP does not contain 'unsafe-eval'", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(csp).not.toContain("unsafe-eval");
    });

    it("uses a per-response nonce instead of allowing inline scripts", async () => {
        const event = createMockEvent("/");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        expect(event.context.cspNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(csp).toContain(`script-src 'self' 'nonce-${event.context.cspNonce}'`);
        expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    });

    it("CSP directives are separated by semicolons", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        const directives = csp
            .split(";")
            .map((d) => d.trim())
            .filter(Boolean);
        expect(directives.length).toBeGreaterThanOrEqual(10);
        // Each directive should start with a known directive name
        for (const directive of directives) {
            expect(directive).toMatch(/^[a-z-]+ /);
        }
    });

    it("CSP has exactly 10 directive groups", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const csp = event.node.res.getHeader("content-security-policy") as string;
        const directives = csp
            .split(";")
            .map((d) => d.trim())
            .filter(Boolean);
        expect(directives).toHaveLength(10);
    });

    // -----------------------------------------------------------------------
    // Route coverage
    // -----------------------------------------------------------------------

    it("applies headers on an API route with path parameters", async () => {
        const event = createMockEvent("/api/teams/42");
        await middleware(event);

        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event.node.res.getHeader("content-security-policy")).toContain("default-src 'self'");
    });

    it("applies headers on the root route", async () => {
        const event = createMockEvent("/");
        await middleware(event);

        expect(event.node.res.getHeader("strict-transport-security")).toBeTruthy();
        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event.node.res.getHeader("content-security-policy")).toContain("default-src 'self'");
    });

    it("applies headers on a deeply nested page route", async () => {
        const event = createMockEvent("/dashboard/settings/profile");
        await middleware(event);

        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event.node.res.getHeader("x-content-type-options")).toBe("nosniff");
        expect(event.node.res.getHeader("referrer-policy")).toBe("strict-origin-when-cross-origin");
    });

    it("applies headers on a route with query string", async () => {
        const event = createMockEvent("/dashboard?tab=results&page=2");
        await middleware(event);

        expect(event.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event.node.res.getHeader("content-security-policy")).toContain(
            "frame-ancestors 'none'",
        );
    });

    // -----------------------------------------------------------------------
    // Behavioral checks
    // -----------------------------------------------------------------------

    it("middleware is a function", async () => {
        expect(typeof middleware).toBe("function");
    });

    it("sets exactly 6 different security headers", async () => {
        const event = createMockEvent("/dashboard");
        await middleware(event);

        // setHeader should have been called 6 times — once per header
        expect(event.node.res.setHeader).toHaveBeenCalledTimes(6);
    });

    it("does not set duplicate headers", async () => {
        const event = createMockEvent("/api/test");
        await middleware(event);

        const callNames = (event.node.res.setHeader as any).mock.calls.map(
            ([name]: [string]) => name,
        );
        const uniqueNames = new Set(callNames);
        expect(uniqueNames.size).toBe(7);
        expect(uniqueNames.size).toBe(callNames.length);
    });

    it("uses distinct CSP nonces for each response", async () => {
        const event1 = createMockEvent("/api/test");
        await middleware(event1);

        const event2 = createMockEvent("/api/test");
        await middleware(event2);

        expect(event1.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event2.node.res.getHeader("x-frame-options")).toBe("DENY");
        expect(event1.context.cspNonce).not.toBe(event2.context.cspNonce);
    });

    it("the six baseline headers match the expected set", async () => {
        const event = createMockEvent("/dashboard");
        await middleware(event);

        const callNames = (event.node.res.setHeader as any).mock.calls.map(
            ([name]: [string]) => name,
        );
        const expected = [
            "Strict-Transport-Security",
            "X-Frame-Options",
            "X-Content-Type-Options",
            "Referrer-Policy",
            "Permissions-Policy",
            "Content-Security-Policy",
        ];
        for (const name of expected) {
            expect(callNames).toContain(name);
        }
        expect(callNames).toHaveLength(6);
    });

    it.each(["/api", "/api/teams/42", "/api/auth/session?refresh=1"])(
        "marks API response %s as private and non-cacheable",
        async (path) => {
            const event = createMockEvent(path);
            await middleware(event);

            expect(event.node.res.getHeader("cache-control")).toBe("private, no-store");
        },
    );

    it.each(["/", "/dashboard", "/assets/logo.svg", "/_nuxt/app.js", "/fonts/site.woff2"])(
        "does not set API cache policy on page or asset path %s",
        async (path) => {
            const event = createMockEvent(path);
            await middleware(event);

            expect(event.node.res.getHeader("cache-control")).toBeUndefined();
        },
    );
});
