import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linkMockState = vi.hoisted(() => ({
    errorCode: "" as "" | "EPERM" | "EXDEV",
    calls: 0,
    successAsCopy: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        link: async (...args: Parameters<typeof actual.link>) => {
            linkMockState.calls += 1;
            if (linkMockState.errorCode) {
                throw Object.assign(new Error(`simulated ${linkMockState.errorCode}`), {
                    code: linkMockState.errorCode,
                });
            }
            if (linkMockState.successAsCopy) {
                await actual.copyFile(args[0], args[1]);
                return;
            }
            return actual.link(...args);
        },
    };
});

import {
    createUserAssetContentAddressed,
    publishStagedAssetContentAddressed,
    stageAssetFromStream,
} from "~~/server/utils/assets";
import { storeMultipartAsset } from "~~/server/utils/multipart-upload";

function multipartRequest(filename: string, bytes: Buffer) {
    const boundary = "asset-link-fallback-boundary";
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const request = Readable.from([body]) as IncomingMessage;
    const contentType = `multipart/form-data; boundary=${boundary}`;
    request.headers = { "content-type": contentType, "content-length": String(body.length) };
    return { request, contentType };
}

describe("asset hard-link publication fallbacks", () => {
    let temporaryRoot: string;
    let storageRoot: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        temporaryRoot = await mkdtemp(join(tmpdir(), "asset-link-fallback-"));
        storageRoot = join(temporaryRoot, "assets-root");
        cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(temporaryRoot);
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", storageRoot);
        linkMockState.errorCode = "";
        linkMockState.calls = 0;
        linkMockState.successAsCopy = false;
    });

    afterEach(async () => {
        cwdSpy?.mockRestore();
        vi.unstubAllEnvs();
        linkMockState.errorCode = "";
        linkMockState.calls = 0;
        linkMockState.successAsCopy = false;
        await rm(temporaryRoot, { recursive: true, force: true });
    });

    const storedPath = (collection: "assets" | "userassets", name: string) =>
        join(storageRoot, collection, ...name.split("/"));

    it.each(["EPERM", "EXDEV"] as const)(
        "uses exclusive copy publication and deduplicates profile bytes when link returns %s",
        async (errorCode) => {
            linkMockState.errorCode = errorCode;
            const bytes = Buffer.from("profile content-addressed fallback bytes");

            const paths = await Promise.all([
                createUserAssetContentAddressed(bytes, ".jpg"),
                createUserAssetContentAddressed(bytes, ".jpeg"),
            ]);

            expect(paths[1]).toBe(paths[0]);
            await expect(readFile(storedPath("userassets", paths[0]))).resolves.toEqual(bytes);
            await expect(readdir(join(storageRoot, "userassets", "profiles"))).resolves.toEqual([
                paths[0].slice("profiles/".length),
            ]);
            expect(linkMockState.calls).toBeGreaterThanOrEqual(2);
        },
    );

    it("publishes a new staged object when hard-link creation succeeds", async () => {
        linkMockState.successAsCopy = true;
        const bytes = Buffer.from("hard-link publication succeeds");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const digest = createHash("sha256").update(bytes).digest("hex");

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).resolves.toEqual({ filename: `${digest}.txt`, relativePath: `uploads/${digest}.txt` });
        await expect(readFile(storedPath("assets", `uploads/${digest}.txt`))).resolves.toEqual(
            bytes,
        );
    });

    it("reuses identical content when the exclusive fallback finds a destination race", async () => {
        linkMockState.errorCode = "EPERM";
        const bytes = Buffer.from("matching pre-existing upload content");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, bytes);
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).resolves.toEqual({ filename: `${digest}.txt`, relativePath: `uploads/${digest}.txt` });
        await expect(readFile(destination)).resolves.toEqual(bytes);
    });

    it("rejects a mismatching existing profile object during the fallback without replacing it", async () => {
        linkMockState.errorCode = "EPERM";
        const incoming = Buffer.from("profile bytes expected by the caller");
        const path = `profiles/${createHash("sha256").update(incoming).digest("hex")}.png`;
        const existing = Buffer.from(incoming);
        existing[0] ^= 1;
        const destination = storedPath("userassets", path);
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(destination, existing);

        await expect(createUserAssetContentAddressed(incoming, ".png")).rejects.toThrow(
            "does not match its digest",
        );
        await expect(readFile(destination)).resolves.toEqual(existing);
    });

    it.each(["EPERM", "EXDEV"] as const)(
        "publishes a staged multipart upload through the exclusive copy fallback when link returns %s",
        async (errorCode) => {
            linkMockState.errorCode = errorCode;
            const bytes = Buffer.from("small text upload");
            const { request, contentType } = multipartRequest("notes.txt", bytes);

            const published = await storeMultipartAsset(request, contentType, "assets");
            const expectedDigest = createHash("sha256").update(bytes).digest("hex");

            expect(published).toEqual({
                filename: `${expectedDigest}.txt`,
                relativePath: `uploads/${expectedDigest}.txt`,
            });
            await expect(readFile(storedPath("assets", published.relativePath))).resolves.toEqual(
                bytes,
            );
            await expect(readdir(join(storageRoot, "assets", ".staging"))).resolves.toEqual([]);
            expect(linkMockState.calls).toBe(2);
        },
    );

    it("rejects a colliding staged upload under fallback without changing the existing bytes", async () => {
        linkMockState.errorCode = "EPERM";
        const bytes = Buffer.from("content for this stable hash");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        const existing = Buffer.from("tampered object at the expected address");
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, existing);

        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            1024,
            undefined,
            "assets",
        );
        const published = publishStagedAssetContentAddressed(stagedName, ".txt", "assets");
        await expect(published).rejects.toThrow("collision");
        linkMockState.errorCode = "";

        await expect(readFile(destination)).resolves.toEqual(existing);
        await expect(readdir(join(storageRoot, "assets", ".staging"))).resolves.toEqual([]);
    });
});
