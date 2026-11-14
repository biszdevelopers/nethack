import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { MAX_DEBUG_UPLOAD_BYTES, storeMultipartAsset } from "~~/server/utils/multipart-upload";

function createRequest(
    parts: Array<{ name: string; filename?: string; content: Buffer | string }>,
    boundary = "upload-boundary-test",
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
    const contentType = `multipart/form-data; boundary=${boundary}`;
    request.headers = {
        "content-type": contentType,
        ...(includeLength ? { "content-length": String(body.length) } : {}),
    };
    return { request, contentType };
}

function signaturePayload(extension: string): Buffer {
    const payload = Buffer.alloc(16, 0x61);
    switch (extension) {
        case ".gif":
            payload.write("GIF89a", 0, "ascii");
            break;
        case ".jpg":
        case ".jpeg":
            payload.set([0xff, 0xd8, 0xff]);
            break;
        case ".mp4":
            payload.write("ftyp", 4, "ascii");
            break;
        case ".pdf":
            payload.write("%PDF-", 0, "ascii");
            break;
        case ".png":
            payload.set([137, 80, 78, 71, 13, 10, 26, 10]);
            break;
        case ".webp":
            payload.write("RIFF", 0, "ascii");
            payload.write("WEBP", 8, "ascii");
            break;
        case ".zip":
            payload.set([0x50, 0x4b, 0x03, 0x04]);
            break;
    }
    return payload;
}

describe("multipart upload validation boundaries", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "upload-boundaries-"));
        vi.stubEnv("ASSET_STORAGE_DIR", join(tempDir, "persistent"));
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    async function listUploads() {
        try {
            return await readdir(join(tempDir, "persistent", "assets", "uploads"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
    }

    it.each([".gif", ".jpg", ".jpeg", ".mp4", ".pdf", ".png", ".webp", ".zip"])(
        "accepts a valid %s magic signature",
        async (extension) => {
            const payload = signaturePayload(extension);
            const { request, contentType } = createRequest([
                { name: "file", filename: `valid${extension}`, content: payload },
            ]);

            const stored = await storeMultipartAsset(request, contentType);

            const canonicalExtension = extension === ".jpeg" ? ".jpg" : extension;
            expect(stored.filename).toMatch(new RegExp(`^[0-9a-f]{64}\\${canonicalExtension}$`));
            expect(stored.relativePath).toBe(`uploads/${stored.filename}`);
            expect(
                await readFile(join(tempDir, "persistent", "assets", stored.relativePath)),
            ).toEqual(payload);
        },
    );

    it("rejects a multipart body without a file part", async () => {
        const { request, contentType } = createRequest([{ name: "note", content: "only a field" }]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Upload exactly one file and no extra fields",
        });
    });

    it("rejects a file supplied under a different field name", async () => {
        const { request, contentType } = createRequest([
            { name: "attachment", filename: "note.txt", content: "text" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Upload exactly one file using the file field",
        });
    });

    it("rejects multiple files and leaves no stored or temporary file", async () => {
        const { request, contentType } = createRequest([
            { name: "file", filename: "one.txt", content: "first" },
            { name: "file", filename: "two.txt", content: "second" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(listUploads()).resolves.toEqual([]);
    });

    it("rejects a streamed file just over the file limit within the multipart overhead budget", async () => {
        const { request, contentType } = createRequest(
            [
                {
                    name: "file",
                    filename: "large.txt",
                    content: Buffer.alloc(MAX_DEBUG_UPLOAD_BYTES + 1, 0x61),
                },
            ],
            "file-limit-boundary",
            false,
        );

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 413,
            statusMessage: "File too large",
        });
        await expect(listUploads()).resolves.toEqual([]);
    });
});
