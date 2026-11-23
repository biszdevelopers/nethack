import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const h3 = vi.hoisted(() => ({
    setResponseHeader: vi.fn((event: any, name: string, value: string) => {
        event.resHeaders[name.toLowerCase()] = value;
    }),
    setResponseStatus: vi.fn((event: any, status: number) => {
        event.status = status;
    }),
    send: vi.fn((_event: any, body: string) => body),
}));

vi.mock("h3", () => ({
    getRequestHeader: (event: any, name: string) => event.reqHeaders[name.toLowerCase()],
    setResponseHeader: h3.setResponseHeader,
    setResponseStatus: h3.setResponseStatus,
    send: h3.send,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    getCachedSessionUserId: () => 42,
}));

let errorHandler: any;
let requestLog: any;

beforeAll(async () => {
    vi.stubGlobal("defineNitroErrorHandler", (handler: any) => handler);
    vi.stubGlobal("defineEventHandler", (handler: any) => handler);
    errorHandler = (await import("~~/server/error")).default;
    requestLog = (await import("~~/server/middleware/00.request-log")).default;
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function event(overrides: Record<string, unknown> = {}) {
    return {
        reqHeaders: { accept: "application/json" } as Record<string, string>,
        resHeaders: {} as Record<string, string>,
        status: 0,
        path: "/api/teams",
        method: "GET",
        context: { requestId: "req-1" },
        node: { res: { statusCode: 200, once: vi.fn() } },
        ...overrides,
    };
}

describe("WWW-Authenticate discipline", () => {
    it("sets the challenge only for a 401 invalid_token response", () => {
        const current = event();
        errorHandler(
            { statusCode: 401, statusMessage: "invalid_token", message: "Invalid access token" },
            current,
        );

        expect(current.status).toBe(401);
        expect(current.resHeaders["www-authenticate"]).toBe('Bearer error="invalid_token"');
    });

    it("does not attach the challenge to other statuses", () => {
        const current = event();
        errorHandler(
            { statusCode: 403, statusMessage: "invalid_token", message: "Forbidden" },
            current,
        );

        expect(current.status).toBe(403);
        expect(current.resHeaders["www-authenticate"]).toBeUndefined();
    });

    it("keeps token details out of the error body", () => {
        const current = event();
        const body = errorHandler(
            {
                statusCode: 401,
                statusMessage: "invalid_token",
                message: "refresh-token-secret-value is invalid",
            },
            current,
        );

        expect(current.resHeaders["www-authenticate"]).not.toContain("refresh-token-secret-value");
        expect(body).not.toContain("refresh-token-secret-value");
    });
});

describe("request logging", () => {
    it("logs a pathname without query strings or identity values", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        let finish: (() => void) | undefined;
        const current = event({
            path: "/api/teams?token=secret-value&email=person@example.test",
            method: "POST",
            context: { requestId: "req-2" },
            node: {
                res: {
                    statusCode: 200,
                    once: (_name: string, handler: () => void) => {
                        finish = handler;
                    },
                },
            },
        });

        requestLog(current);
        finish!();

        expect(info).toHaveBeenCalledTimes(1);
        const entry = JSON.parse(info.mock.calls[0]![0] as string);
        expect(entry).toEqual({
            event: "http_request",
            method: "POST",
            pathname: "/api/teams",
            status: 200,
            duration_ms: expect.any(Number),
            request_id: "req-2",
            user_id: 42,
        });
        expect(JSON.stringify(entry)).not.toContain("secret-value");
        expect(JSON.stringify(entry)).not.toContain("person@example.test");
    });
});
