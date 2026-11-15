import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { storeMultipartAsset } from "~~/server/utils/multipart-upload";

function createTwoFileRequest() {
    const boundary = "upload-rollback-test";
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="first.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        ),
        Buffer.from("new upload"),
        Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        ),
        Buffer.from("second upload"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const contentType = `multipart/form-data; boundary=${boundary}`;
    const request = Readable.from([body]) as IncomingMessage;
    request.headers = { "content-type": contentType, "content-length": String(body.length) };
    return { request, contentType };
}

describe("multipart rejected-upload staging", () => {
    let tempDir: string;
    let assetRoot: string;
    let uploadDir: string;
    let stagingDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "upload-rollback-"));
        assetRoot = join(tempDir, "persistent");
        uploadDir = join(assetRoot, "assets", "uploads");
        stagingDir = join(assetRoot, "assets", ".staging");
        await mkdir(uploadDir, { recursive: true });
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", assetRoot);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it("discards the private staging file after rejecting a multiple-file request", async () => {
        const { request, contentType } = createTwoFileRequest();

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });

        await expect(readdir(uploadDir)).resolves.toEqual([]);
        await expect(readdir(stagingDir)).resolves.toEqual([]);
    });

    it("preserves a pre-existing shared content-addressed object after a late request error", async () => {
        const original = Buffer.from("new upload");
        const digest = createHash("sha256").update(original).digest("hex");
        const filename = `${digest}.txt`;
        await writeFile(join(uploadDir, filename), original);
        const { request, contentType } = createTwoFileRequest();

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });

        await expect(readFile(join(uploadDir, filename))).resolves.toEqual(original);
        await expect(readdir(uploadDir)).resolves.toEqual([filename]);
        await expect(readdir(stagingDir)).resolves.toEqual([]);
    });
});
