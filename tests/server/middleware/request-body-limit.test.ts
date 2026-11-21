import { Readable } from "node:stream";
import { readBody } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

describe("API request body limit middleware", () => {
    let middleware: (event: any) => Promise<void>;

    beforeAll(async () => {
        setupNitroGlobals();
        middleware = (await import("~~/server/middleware/01.request-body-limit")).default;
    });

    const eventFor = (path: string, body: Buffer, headers: Record<string, string> = {}) => {
        const request = Object.assign(Readable.from([body]), {
            headers: {
                "content-length": String(body.byteLength),
                "content-type": "application/json",
                ...headers,
            },
        });

        return {
            path,
            method: "POST",
            node: { req: request },
            _requestBody: undefined,
        };
    };

    it("buffers ordinary API payloads under the one MiB limit for downstream validation", async () => {
        const body = Buffer.from('{"name":"team"}');
        const event = eventFor("/api/teams", body);

        await middleware(event);

        expect(event._requestBody).toEqual(body);
        await expect(readBody(event as never)).resolves.toEqual({ name: "team" });
    });

    it("rejects large ordinary API payloads before route parsing", async () => {
        const body = Buffer.alloc(1024 * 1024 + 1);
        const event = eventFor("/api/teams", body);

        await expect(middleware(event)).rejects.toMatchObject({ statusCode: 413 });
        expect(event._requestBody).toBeUndefined();
        expect(event.node.req.isPaused()).toBe(true);
    });

    it("still bounds a body that lies about its Content-Length", async () => {
        const body = Buffer.alloc(1024 * 1024 + 1);
        const event = eventFor("/api/teams", body, {
            "content-length": "16",
        });

        await expect(middleware(event)).rejects.toMatchObject({ statusCode: 413 });
    });

    it("asks the client to close the connection when a response is still writable", async () => {
        const body = Buffer.alloc(1024 * 1024 + 1);
        const setHeader = vi.fn();
        const event = {
            ...eventFor("/api/teams", body),
            node: {
                ...eventFor("/api/teams", body).node,
                res: { headersSent: false, setHeader },
            },
        };

        await expect(middleware(event)).rejects.toMatchObject({ statusCode: 413 });
        expect(setHeader).toHaveBeenCalledWith("Connection", "close");
    });

    it("leaves profile updates unread for authorization and the route-specific limit", async () => {
        const body = Buffer.alloc(1024 * 1024 + 1);
        const event = { ...eventFor("/api/users/123", body), method: "PATCH" };

        await middleware(event);

        expect(event._requestBody).toBeUndefined();
        expect(event.node.req.readableEnded).toBe(false);
    });

    it.each(["/api/_webhooks/update", "/api/_webhooks/lifecycle"])(
        "leaves the route-specific streaming limit to %s",
        async (path) => {
            const event = eventFor(path, Buffer.from("streamed"));

            await middleware(event);

            expect(event._requestBody).toBeUndefined();
            expect(event.node.req.readableEnded).toBe(false);
        },
    );

    it.each(["/api/_webhooks/update?x=1", "/api/_webhooks/lifecycle?x=1", "/api/users/123?x=1"])(
        "ignores query strings when applying body exemptions for %s",
        async (path) => {
            const body = Buffer.alloc(1024 * 1024 + 1);
            const event = {
                ...eventFor(path, body),
                method: path.startsWith("/api/users/") ? "PATCH" : "POST",
            };

            await middleware(event);

            expect(event._requestBody).toBeUndefined();
            expect(event.node.req.readableEnded).toBe(false);
        },
    );
});
