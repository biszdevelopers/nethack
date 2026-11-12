import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

const { randomUuidMock } = vi.hoisted(() => ({ randomUuidMock: vi.fn() }));

vi.mock("node:crypto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:crypto")>()),
    randomUUID: randomUuidMock,
}));

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

describe("multipart rejected-upload rollback", () => {
    let tempDir: string;
    let uploadDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "upload-rollback-"));
        uploadDir = join(tempDir, "persistent", "assets", "uploads");
        await mkdir(uploadDir, { recursive: true });
        vi.stubEnv("ASSET_STORAGE_DIR", join(tempDir, "persistent"));
        randomUuidMock.mockReset();
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it("removes the first published file after rejecting a multiple-file request", async () => {
        randomUuidMock.mockReturnValueOnce("new-upload-id").mockReturnValue("second-upload-id");
        const { request, contentType } = createTwoFileRequest();

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });

        await expect(readdir(uploadDir)).resolves.toEqual([]);
    });

    it("preserves a pre-existing same-name asset when a rejected upload rolls back", async () => {
        const original = Buffer.from("pre-existing user asset");
        await writeFile(join(uploadDir, "collision-id.txt"), original);
        randomUuidMock
            .mockReturnValueOnce("collision-id")
            .mockReturnValueOnce("new-upload-id")
            .mockReturnValue("second-upload-id");
        const { request, contentType } = createTwoFileRequest();

        await expect(storeMultipartAsset(request, contentType)).rejects.toMatchObject({
            statusCode: 400,
        });

        await expect(readFile(join(uploadDir, "collision-id.txt"))).resolves.toEqual(original);
        await expect(readdir(uploadDir)).resolves.toEqual(["collision-id.txt"]);
    });
});
