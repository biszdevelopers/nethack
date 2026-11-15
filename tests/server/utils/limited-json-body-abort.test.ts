import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readLimitedRequestBody } from "~~/server/utils/limited-json-body";

function createEvent() {
    const request = Object.assign(new PassThrough(), {
        headers: { "content-type": "application/json" },
    });
    return { event: { node: { req: request, res: {} } } as any, request };
}

describe("readLimitedRequestBody when a client disconnects", () => {
    it.each(["aborted", "close"] as const)(
        "rejects an incomplete body when the request emits %s before end",
        async (eventName) => {
            const { event, request } = createEvent();
            const pendingRead = readLimitedRequestBody(event, 32);

            request.write(Buffer.from('{"partial":'));
            request.emit(eventName);

            await expect(pendingRead).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: "Incomplete Request Body",
            });
        },
    );

    it("does not turn a normal completed request close into an error", async () => {
        const { event, request } = createEvent();
        const pendingRead = readLimitedRequestBody(event, 32);

        request.end(Buffer.from("complete"));
        await expect(pendingRead).resolves.toEqual(Buffer.from("complete"));
        request.emit("close");
    });

    it("counts UTF-8 bytes and accepts a body exactly at the limit", async () => {
        const { event, request } = createEvent();
        const pendingRead = readLimitedRequestBody(event, 4);

        request.end(Buffer.from("éé"));

        await expect(pendingRead).resolves.toEqual(Buffer.from("éé"));
    });

    it("propagates an underlying request stream error", async () => {
        const { event, request } = createEvent();
        const pendingRead = readLimitedRequestBody(event, 32);
        const streamError = new Error("client socket reset");

        request.destroy(streamError);

        await expect(pendingRead).rejects.toBe(streamError);
    });
});
