import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readLimitedJsonBody } from "~~/server/utils/limited-json-body";

function eventFor(body: string, headers: Record<string, string> = {}) {
    const responseHeaders: Record<string, string> = {};
    return {
        node: {
            req: Object.assign(Readable.from([Buffer.from(body)]), {
                headers: { "content-type": "application/json", ...headers },
            }),
            res: {
                headersSent: false,
                setHeader(name: string, value: string) {
                    responseHeaders[name.toLowerCase()] = value;
                },
            },
        },
        responseHeaders,
    } as any;
}

describe("readLimitedJsonBody", () => {
    it("parses a JSON body within the configured byte limit", async () => {
        await expect(readLimitedJsonBody(eventFor('{"value":1}'), 32)).resolves.toEqual({
            value: 1,
        });
    });

    it("rejects a body that exceeds its streaming byte limit", async () => {
        const event = eventFor('{"value":"' + "x".repeat(40) + '"}');
        await expect(readLimitedJsonBody(event, 32)).rejects.toMatchObject({ statusCode: 413 });
        expect(event.responseHeaders.connection).toBe("close");
    });

    it("rejects an oversized declared length before buffering", async () => {
        const event = eventFor("{}", { "content-length": "33" });
        await expect(readLimitedJsonBody(event, 32)).rejects.toMatchObject({ statusCode: 413 });
        expect(event.responseHeaders.connection).toBe("close");
    });

    it("rejects compressed JSON instead of inflating an unbounded payload", async () => {
        await expect(
            readLimitedJsonBody(eventFor("{}", { "content-encoding": "gzip" }), 32),
        ).rejects.toMatchObject({ statusCode: 415 });
    });

    it("rejects malformed JSON with a client error", async () => {
        await expect(readLimitedJsonBody(eventFor("{"), 32)).rejects.toMatchObject({
            statusCode: 400,
        });
    });
});
