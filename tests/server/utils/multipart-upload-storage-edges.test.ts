import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Readable } from "node:stream";
import { MAX_DEBUG_UPLOAD_BYTES, storeMultipartAsset } from "~~/server/utils/multipart-upload";
import { publishStagedAssetContentAddressed, stageAssetFromStream } from "~~/server/utils/assets";

function requestFor(parts: Array<{ name: string; filename?: string; content: string | Buffer }>) {
    const boundary = "multipart-storage-edge";
    const body = Buffer.concat([
        ...parts.flatMap((part) => [
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n\r\n`,
            ),
            Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content),
            Buffer.from("\r\n"),
        ]),
        Buffer.from(`--${boundary}--\r\n`),
    ]);
    const request = Readable.from([body]) as IncomingMessage;
    const contentType = `multipart/form-data; boundary=${boundary}`;
    request.headers = { "content-type": contentType, "content-length": String(body.length) };
    return { request, contentType };
}

describe("multipart storage failure boundaries", () => {
    let tempDir: string;
    let storageDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "multipart-storage-edge-"));
        storageDir = join(tempDir, "persistent");
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it.each([
        "not-a-number",
        "-1",
        String(Number.MAX_SAFE_INTEGER + 1),
        String(MAX_DEBUG_UPLOAD_BYTES + 64 * 1024 + 1),
    ])("rejects invalid or oversized declared content length %s", async (contentLength) => {
        const request = Readable.from([]) as IncomingMessage;
        request.headers = { "content-length": contentLength };

        await expect(
            storeMultipartAsset(request, "multipart/form-data; boundary=x"),
        ).rejects.toMatchObject({
            statusCode: 413,
            statusMessage: "Upload request is too large",
        });
    });

    it("removes only the staged user asset when an extra form field invalidates the upload", async () => {
        const { request, contentType } = requestFor([
            { name: "file", filename: "notes.txt", content: "file contents" },
            { name: "comment", content: "not allowed" },
        ]);

        await expect(storeMultipartAsset(request, contentType, "userassets")).rejects.toMatchObject(
            {
                statusCode: 400,
                statusMessage: "Upload exactly one file and no extra fields",
            },
        );

        await expect(readdir(join(storageDir, "userassets"))).resolves.toEqual([".staging"]);
        await expect(readdir(join(storageDir, "userassets", ".staging"))).resolves.toEqual([]);
    });

    it("returns a storage error when the destination collection is not a directory", async () => {
        await mkdir(storageDir, { recursive: true });
        await writeFile(join(storageDir, "userassets"), "not a directory");
        const { request, contentType } = requestFor([
            { name: "file", filename: "notes.txt", content: "file contents" },
        ]);

        await expect(storeMultipartAsset(request, contentType, "userassets")).rejects.toMatchObject(
            {
                statusCode: 500,
                statusMessage: "Unable to store uploaded file",
            },
        );
    });

    it("rejects a corrupted object at the expected content address without overwriting it", async () => {
        const uploadDirectory = join(storageDir, "assets", "uploads");
        await mkdir(uploadDirectory, { recursive: true });
        const incoming = Buffer.from("new upload");
        const digest = createHash("sha256").update(incoming).digest("hex");
        const filename = `${digest}.txt`;
        const existing = Buffer.from("incorrect existing bytes");
        await writeFile(join(uploadDirectory, filename), existing);
        const { request, contentType } = requestFor([
            { name: "file", filename: "incoming.txt", content: incoming },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Unable to store uploaded file",
        });

        await expect(readFile(join(uploadDirectory, filename))).resolves.toEqual(existing);
        await expect(readdir(uploadDirectory)).resolves.toEqual([filename]);
    });

    it("cleans up after an interrupted multipart parser stream", async () => {
        const request = new PassThrough() as IncomingMessage;
        request.headers = { "content-type": "multipart/form-data; boundary=interrupted" };
        const pending = storeMultipartAsset(request, request.headers["content-type"] as string);

        request.write("--interrupted\r\n");
        request.destroy(new Error("client disconnected"));

        await expect(pending).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Malformed multipart upload",
        });
    });

    it("rejects an empty multipart body with no file part", async () => {
        const { request, contentType } = requestFor([]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "No file uploaded",
        });
    });

    it("releases the staging lease when publication preflight fails", async () => {
        const bytes = Buffer.from("staged bytes");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            128,
            undefined,
            "assets",
        );
        await rm(join(storageDir, "assets", stagedName));

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toBeDefined();
        await expect(readdir(join(storageDir, "assets", ".staging"))).resolves.toEqual([]);
    });

    it("rejects multipart bodies that exceed the part limit", async () => {
        const { request, contentType } = requestFor([
            { name: "file", filename: "one.txt", content: "first" },
            { name: "file", filename: "two.txt", content: "second" },
            { name: "file", filename: "three.txt", content: "third" },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Upload exactly one file",
        });
        await expect(
            readdir(join(storageDir, "assets", "uploads")).catch((error) => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
                throw error;
            }),
        ).resolves.toEqual([]);
    });

    it("maps a file-size limit failure to HTTP 413", async () => {
        const { request, contentType } = requestFor([
            {
                name: "file",
                filename: "large.txt",
                content: Buffer.alloc(MAX_DEBUG_UPLOAD_BYTES + 1, 0x61),
            },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 413,
            statusMessage: "File too large",
        });
        await expect(
            readdir(join(storageDir, "assets", "uploads")).catch((error) => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
                throw error;
            }),
        ).resolves.toEqual([]);
    });

    it("maps invalid file signatures to HTTP 400", async () => {
        const { request, contentType } = requestFor([
            { name: "file", filename: "invalid.png", content: Buffer.alloc(16, 0x41) },
        ]);

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid file content",
        });
    });
});
