import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";

const { parserMock, busboyMock } = vi.hoisted(() => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const parser = {
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            return parser;
        }),
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            return parser;
        }),
        emit: (event: string) => {
            for (const listener of listeners.get(event) ?? []) listener();
        },
        destroy: vi.fn(),
        reset: () => {
            listeners.clear();
            parser.on.mockClear();
            parser.once.mockClear();
            parser.destroy.mockClear();
            busboyMock.mockClear();
        },
    };
    return { parserMock: parser, busboyMock: vi.fn(() => parser) };
});

vi.mock("busboy", () => ({ default: busboyMock }));

import { storeMultipartAsset } from "~~/server/utils/multipart-upload";

describe("multipart parser limit events", () => {
    afterEach(() => {
        parserMock.reset();
        vi.restoreAllMocks();
    });

    it.each(["field", "partsLimit"])("rejects when the parser reports %s", async (eventName) => {
        const request = new PassThrough() as IncomingMessage;
        request.headers = {};
        vi.spyOn(request, "pipe").mockImplementation((destination: NodeJS.WritableStream) => {
            parserMock.emit(eventName);
            parserMock.emit("close");
            return destination;
        });

        await expect(
            storeMultipartAsset(request, "multipart/form-data; boundary=parts"),
        ).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Upload exactly one file and no extra fields",
        });

        expect(parserMock.on).toHaveBeenCalledWith(eventName, expect.any(Function));
        expect(busboyMock).toHaveBeenCalledOnce();
    });
});
