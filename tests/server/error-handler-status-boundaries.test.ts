import { APIError } from "@basis/schema/api";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h3 = vi.hoisted(() => ({
    getRequestHeader: vi.fn((event: any, name: string) => event.headers?.[name]),
    send: vi.fn((_event: any, body: string) => body),
    setResponseHeader: vi.fn(),
    setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => h3);

let handler: (input: any, event: any) => unknown;

beforeAll(async () => {
    vi.stubGlobal("defineNitroErrorHandler", (value: (input: any, event: any) => unknown) => value);
    handler = (await import("~~/server/error")).default;
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function invoke(input: any, accept = "application/json") {
    const event = { headers: { accept } };
    const output = handler(input, event);
    return {
        event,
        body: accept.includes("text/html") ? output : JSON.parse(String(output)),
    };
}

describe("canonical error handler status boundaries", () => {
    it.each([
        [400, "invalid_request"],
        [401, "invalid_token"],
        [403, "forbidden"],
        [404, "not_found"],
        [409, "conflict"],
        [429, "rate_limited"],
        [418, "server_error"],
    ])("maps HTTP status %i to the stable error code %s", (status, error) => {
        const { body, event } = invoke({ status, message: "safe failure" });

        expect(body).toEqual({
            status,
            code: status,
            error,
            error_description: "safe failure",
        });
        expect(h3.setResponseStatus).toHaveBeenCalledWith(event, status);
        expect(h3.setResponseHeader).toHaveBeenCalledWith(event, "cache-control", "no-store");
        expect(h3.setResponseHeader).toHaveBeenCalledWith(event, "vary", "Accept");
        expect(h3.setResponseHeader).toHaveBeenCalledWith(
            event,
            "content-type",
            "application/json; charset=utf-8",
        );
    });

    it.each(["invalid_token", "insufficient_permission"])(
        "preserves the explicit authorization error name %s",
        (statusMessage) => {
            const { body } = invoke({ status: 403, statusMessage, message: "Access denied" });

            expect(body).toMatchObject({ status: 403, error: statusMessage });
        },
    );

    it("uses a nested cause and falls back to the outer HTTP status and message", () => {
        const { body } = invoke({
            cause: { message: "" },
            statusCode: 409,
            message: "The outer conflict message",
        });

        expect(body).toEqual({
            status: 409,
            code: 409,
            error: "conflict",
            error_description: "The outer conflict message",
        });
    });

    it("uses the generic safe message when no nested or outer message exists", () => {
        const { body } = invoke({ cause: { message: "" }, statusCode: 400, message: "" });

        expect(body).toMatchObject({
            status: 400,
            error: "invalid_request",
            error_description: "The request is invalid",
        });
    });

    it("uses the default 500 status when every status source is absent", () => {
        const { body } = invoke({ cause: { message: "unexpected" }, message: "outer" });

        expect(body).toEqual({
            status: 500,
            code: 500,
            error: "server_error",
            error_description: "The request could not be completed",
        });
        expect(console.error).toHaveBeenCalledOnce();
    });

    it("keeps an APIError instance unchanged while still applying response headers", () => {
        const failure = new APIError("forbidden", "Explicit denial", 403, "custom_code");
        const { body, event } = invoke(failure);

        expect(body).toEqual({
            status: 403,
            code: "custom_code",
            error: "forbidden",
            error_description: "Explicit denial",
        });
        expect(h3.setResponseStatus).toHaveBeenCalledWith(event, 403);
        expect(console.error).not.toHaveBeenCalled();
    });

    it("renders safe nested errors as HTML without exposing internal details", () => {
        const { body, event } = invoke(
            { cause: { status: 403, message: "secret account detail" } },
            "text/html",
        );

        expect(body).toContain("go back home</a> (403)</h1>");
        expect(body).not.toContain("secret account detail");
        expect(h3.setResponseHeader).toHaveBeenCalledWith(
            event,
            "content-type",
            "text/html; charset=utf-8",
        );
    });

    it("defaults to JSON when the request has no Accept header", () => {
        const event = { headers: {} };
        const body = JSON.parse(String(handler({ statusCode: 404 }, event)));

        expect(body).toMatchObject({ status: 404, error: "not_found" });
        expect(h3.setResponseHeader).toHaveBeenCalledWith(
            event,
            "content-type",
            "application/json; charset=utf-8",
        );
    });
});
