import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_DEBUG_UPLOAD_BYTES, storeMultipartAsset } from "~~/server/utils/multipart-upload";
import { getAssetStorageRoot } from "~~/server/utils/assets";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function createRequest(
    parts: Array<{ name: string; filename?: string; content: Buffer | string }>,
    boundary = "upload-test-boundary",
    includeLength = true,
) {
    const buffers: Buffer[] = [];
    for (const part of parts) {
        buffers.push(
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${
                    part.filename ? `; filename="${part.filename}"` : ""
                }\r\n${part.filename ? "Content-Type: application/octet-stream\r\n" : ""}\r\n`,
            ),
            Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content),
            Buffer.from("\r\n"),
        );
    }
    buffers.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(buffers);
    const request = Readable.from([body]) as IncomingMessage;
    request.headers = {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        ...(includeLength ? { "content-length": String(body.length) } : {}),
    };
    return { request, contentType: request.headers["content-type"] as string };
}

describe("streamed multipart uploads", () => {
    let tempDir: string;
    let storageDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "stream-upload-test-"));
        storageDir = join(tempDir, "persistent");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it("streams a file into persistent storage with a generated name", async () => {
        const payload = Buffer.concat([PNG_SIGNATURE, Buffer.from("image data")]);
        const { request, contentType } = createRequest([
            { name: "file", filename: "screen.PNG", content: payload },
        ]);

        const result = await storeMultipartAsset(request, contentType);
        expect(result.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
        expect(result.relativePath).toBe(`uploads/${result.filename}`);
        expect(await readFile(join(getAssetStorageRoot(), "assets", result.relativePath))).toEqual(
            payload,
        );
        expect(join(getAssetStorageRoot(), "assets")).not.toContain(join(tempDir, "public"));
    });

    it("stores the user mode in the persistent user asset collection", async () => {
        const payload = Buffer.from("plain text");
        const { request, contentType } = createRequest([
            { name: "file", filename: "notes.txt", content: payload },
        ]);

        const result = await storeMultipartAsset(request, contentType, "userassets");
        expect(result.relativePath).toBe(result.filename);
        expect(await readFile(join(getAssetStorageRoot(), "userassets", result.filename))).toEqual(
            payload,
        );
    });

    it("rejects unsupported active content such as SVG", async () => {
        const { request, contentType } = createRequest([
            { name: "file", filename: "script.svg", content: "<svg onload=alert(1)>" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "File extension not allowed",
        });
    });

    it("rejects a file whose bytes do not match its image extension", async () => {
        const { request, contentType } = createRequest([
            { name: "file", filename: "spoofed.png", content: "<script>alert(1)</script>" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid file content",
        });
    });

    it("rejects form fields and additional parts", async () => {
        const { request, contentType } = createRequest([
            { name: "file", filename: "notes.txt", content: "one" },
            { name: "extra", content: "not accepted" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("rejects a request larger than the bounded upload budget before parsing it", async () => {
        const boundary = "large-upload";
        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\n\r\n`,
            ),
            Buffer.alloc(MAX_DEBUG_UPLOAD_BYTES + 1),
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const request = Readable.from([body]) as IncomingMessage;
        request.headers = {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "content-length": String(body.length),
        };

        await expect(
            storeMultipartAsset(request, request.headers["content-type"] as string),
        ).rejects.toMatchObject({
            statusCode: 413,
        });
    });

    it("rejects oversized chunked uploads and removes the partial file", async () => {
        const boundary = "chunked-large-upload";
        const request = Readable.from([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\n\r\n`,
            ),
            Buffer.alloc(MAX_DEBUG_UPLOAD_BYTES, 0x61),
            Buffer.alloc(65 * 1024, 0x61),
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]) as IncomingMessage;
        const contentType = `multipart/form-data; boundary=${boundary}`;
        request.headers = { "content-type": contentType };

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 413,
        });
        const files = await readdir(join(storageDir, "assets", "uploads")).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        });
        expect(files).toEqual([]);
    });

    it("rejects malformed content types without reading the body", async () => {
        const { request } = createRequest([
            { name: "file", filename: "notes.txt", content: "hello" },
        ]);

        await expect(storeMultipartAsset(request, "application/json")).rejects.toMatchObject({
            statusCode: 400,
        });
    });
});
