import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readLimitedRequestBody } from "~~/server/utils/limited-json-body";

function eventFor(request: any, response?: Record<string, unknown>) {
    return { node: { req: request, ...(response ? { res: response } : {}) } } as any;
}

describe("limited request body edge cases", () => {
    it("accepts the identity content encoding and string stream chunks", async () => {
        const request = Object.assign(Readable.from(["hello"]), {
            headers: { "content-encoding": "identity" },
        });

        await expect(readLimitedRequestBody(eventFor(request), 5)).resolves.toEqual(
            Buffer.from("hello"),
        );
    });

    it.each(["not-a-number", "-1", "9007199254740992"])(
        "rejects an invalid declared content length %s before reading",
        async (contentLength) => {
            const request = Object.assign(new PassThrough(), {
                headers: { "content-length": contentLength },
            });
            const pause = vi.spyOn(request, "pause");

            await expect(readLimitedRequestBody(eventFor(request), 32)).rejects.toMatchObject({
                statusCode: 413,
                statusMessage: "Payload Too Large",
            });

            expect(pause).toHaveBeenCalledOnce();
            expect(request.readableEnded).toBe(false);
            request.destroy();
        },
    );

    it("destroys an oversized stream when the response is already committed", async () => {
        const request = Object.assign(new PassThrough(), { headers: {} });
        const pause = vi.spyOn(request, "pause");
        const destroy = vi.spyOn(request, "destroy");
        const pending = readLimitedRequestBody(eventFor(request, { headersSent: true }), 2);

        request.write("too large");

        await expect(pending).rejects.toMatchObject({ statusCode: 413 });
        expect(pause).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it("destroys an oversized stream when no response object is available", async () => {
        const request = Object.assign(new PassThrough(), { headers: {} });
        const destroy = vi.spyOn(request, "destroy");
        const pending = readLimitedRequestBody(eventFor(request), 2);

        request.write("too large");

        await expect(pending).rejects.toMatchObject({ statusCode: 413 });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it("ignores stream callbacks already queued after an abort settled the read", async () => {
        const request = Object.assign(new PassThrough(), { headers: {} });
        const pending = readLimitedRequestBody(eventFor(request), 32);
        const callbacks = {
            end: request.listeners("end")[0] as () => void,
            error: request.listeners("error")[0] as (error: Error) => void,
            aborted: request.listeners("aborted")[0] as () => void,
            close: request.listeners("close")[0] as () => void,
        };

        request.emit("aborted");

        await expect(pending).rejects.toMatchObject({ statusCode: 400 });
        expect(() => {
            callbacks.end();
            callbacks.error(new Error("late stream error"));
            callbacks.aborted();
            callbacks.close();
        }).not.toThrow();
    });
});
