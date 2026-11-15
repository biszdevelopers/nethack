import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough, Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

const { parserMock, assetMocks, busboyMock } = vi.hoisted(() => {
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
        emit: (event: string, ...args: unknown[]) => {
            for (const listener of listeners.get(event) ?? []) listener(...args);
        },
        reset: () => listeners.clear(),
    };
    const assets = {
        stageAssetFromStream: vi.fn(),
        publishStagedAssetContentAddressed: vi.fn(),
        discardStagedAsset: vi.fn(),
    };
    return { parserMock: parser, assetMocks: assets, busboyMock: vi.fn(() => parser) };
});

vi.mock("busboy", () => ({ default: busboyMock }));
vi.mock("~~/server/utils/assets", () => ({ ...assetMocks }));

import { storeMultipartAsset } from "~~/server/utils/multipart-upload";

describe("multipart asset storage error mapping", () => {
    afterEach(() => {
        parserMock.reset();
        vi.restoreAllMocks();
    });

    it.each([
        [400, "Invalid file content"],
        [413, "File too large"],
    ])("preserves a %i storage status", async (statusCode, statusMessage) => {
        const request = new PassThrough() as IncomingMessage;
        request.headers = {};
        vi.spyOn(request, "pipe").mockImplementation((destination: NodeJS.WritableStream) => {
            parserMock.emit("file", "file", Readable.from([]), { filename: "bad.txt" });
            parserMock.emit("close");
            return destination;
        });
        assetMocks.stageAssetFromStream.mockRejectedValue(
            Object.assign(new Error(statusMessage), { statusCode, statusMessage }),
        );

        await expect(
            storeMultipartAsset(request, "multipart/form-data; boundary=error-mapping"),
        ).rejects.toMatchObject({ statusCode, statusMessage });
    });
});
