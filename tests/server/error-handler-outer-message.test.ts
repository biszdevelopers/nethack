import { beforeAll, describe, expect, it, vi } from "vitest";

const h3 = vi.hoisted(() => ({
    getRequestHeader: vi.fn(() => "application/json"),
    send: vi.fn((_event: unknown, value: string) => value),
    setResponseHeader: vi.fn(),
    setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => h3);

describe("error handler outer message fallback", () => {
    let handler: (input: unknown, event: unknown) => unknown;

    beforeAll(async () => {
        vi.stubGlobal("defineNitroErrorHandler", (value: unknown) => value);
        handler = (await import("~~/server/error")).default as typeof handler;
    });

    it("logs outer status and message text when a nested cause omits both", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        handler(
            {
                cause: { status: 500 },
                statusMessage: "outer status",
                message: "outer message",
            },
            { headers: { accept: "application/json" }, path: "/api/x", method: "GET" },
        );

        expect(errorLog).toHaveBeenCalledOnce();
        const payload = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
        expect(payload).toMatchObject({
            status: 500,
            status_message: "outer status",
            message: "outer message",
        });
        errorLog.mockRestore();
    });
});
