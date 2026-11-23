import { beforeAll, describe, expect, it, vi } from "vitest";

describe("request id and request log middleware", () => {
    let requestIdMiddleware: (event: any) => void;
    let requestLogMiddleware: (event: any) => void;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        requestIdMiddleware = (await import("~~/server/middleware/00.request-id")).default;
        requestLogMiddleware = (await import("~~/server/middleware/00.request-log")).default;
    });

    const eventFor = (path: string, incoming?: string) => {
        const responseHeaders: Array<[string, string]> = [];
        const finishHandlers: Array<() => void> = [];
        return {
            event: {
                path,
                method: "POST",
                context: {} as Record<string, unknown>,
                node: {
                    req: { headers: {} },
                    res: {
                        statusCode: 201,
                        setHeader: (name: string, value: string) =>
                            responseHeaders.push([name, value]),
                        once: (name: string, handler: () => void) => {
                            if (name === "finish") finishHandlers.push(handler);
                        },
                    },
                },
            },
            incoming,
            responseHeaders,
            finishHandlers,
        };
    };

    it("reuses a bounded caller request id and echoes it", () => {
        vi.stubGlobal("getHeader", (_event: unknown, name: string) =>
            name === "x-request-id" ? "req_1234-abcd" : undefined,
        );
        vi.stubGlobal("setHeader", (event: any, name: string, value: string) => {
            event.node.res.setHeader(name, value);
        });
        const { event, responseHeaders } = eventFor("/api/teams");
        requestIdMiddleware(event);

        expect(event.context.requestId).toBe("req_1234-abcd");
        expect(responseHeaders).toContainEqual(["x-request-id", "req_1234-abcd"]);
    });

    it("replaces an unbounded or malformed caller id with a UUID", () => {
        vi.stubGlobal("getHeader", () => "bad id with spaces");
        vi.stubGlobal("setHeader", (event: any, name: string, value: string) => {
            event.node.res.setHeader(name, value);
        });
        const { event } = eventFor("/api/teams");
        requestIdMiddleware(event);

        expect(event.context.requestId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it("logs one JSON line with method, pathname, status, duration, and request id", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { event, finishHandlers } = eventFor("/api/teams?invite=secret");
        event.context.requestId = "req-log";

        requestLogMiddleware(event);
        expect(finishHandlers).toHaveLength(1);
        finishHandlers[0]!();

        const logged = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(logged).toMatchObject({
            event: "http_request",
            method: "POST",
            pathname: "/api/teams",
            status: 201,
            request_id: "req-log",
        });
        expect(typeof logged.duration_ms).toBe("number");
        expect(JSON.stringify(logged)).not.toContain("invite=secret");
        info.mockRestore();
        vi.unstubAllEnvs();
    });

    it("logs the resolved numeric user id when available", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { event, finishHandlers } = eventFor("/api/teams");
        event.context.requestId = "req-user";
        event.context.authUserId = 77;

        requestLogMiddleware(event);
        finishHandlers[0]!();

        const logged = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(logged.user_id).toBe(77);
        info.mockRestore();
        vi.unstubAllEnvs();
    });

    it("logs dynamic pages but not static files", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { event, finishHandlers } = eventFor("/dashboard");
        requestLogMiddleware(event);
        finishHandlers[0]!();
        expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
            pathname: "/dashboard",
        });
        info.mockRestore();
        vi.unstubAllEnvs();
    });

    it("normalizes an empty request path to the root route", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { event, finishHandlers } = eventFor("");
        requestLogMiddleware(event);
        finishHandlers[0]!();

        expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ pathname: "/" });
        info.mockRestore();
        vi.unstubAllEnvs();
    });

    it("skips static assets and build output", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        for (const path of ["/_nuxt/app.js", "/assets/logo.svg", "/fonts/site.woff2"]) {
            const { event } = eventFor(path);
            requestLogMiddleware(event);
        }
        expect(info).not.toHaveBeenCalled();
        info.mockRestore();
        vi.unstubAllEnvs();
    });

    it("does not log under the test environment", () => {
        vi.stubEnv("NODE_ENV", "test");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { event, finishHandlers } = eventFor("/api/teams");
        requestLogMiddleware(event);
        expect(finishHandlers).toHaveLength(0);
        expect(info).not.toHaveBeenCalled();
        info.mockRestore();
        vi.unstubAllEnvs();
    });
});
