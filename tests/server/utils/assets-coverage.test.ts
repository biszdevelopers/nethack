import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    assetContentType,
    createAsset,
    createAssetFromStream,
    createUserAsset,
    getAssetStorageRoot,
    getStoredAssetNames,
    getUserAsset,
    isInlineSafeAsset,
    openStoredAsset,
    removeAsset,
    removeUserAsset,
} from "~~/server/utils/assets";

describe("asset helpers coverage", () => {
    let tempDir: string;
    let storageDir: string;
    let assetsDir: string;
    let userAssetsDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "assets-coverage-"));
        storageDir = join(tempDir, "persistent", "assets");
        assetsDir = join(storageDir, "assets");
        userAssetsDir = join(storageDir, "userassets");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
        vi.stubEnv("NODE_ENV", "test");
        vi.spyOn(process, "cwd").mockReturnValue(join(tempDir, "release"));
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("configured storage roots", () => {
        it("trims a configured absolute persistent path", () => {
            vi.stubEnv("ASSET_STORAGE_DIR", `  ${storageDir}  `);
            expect(getAssetStorageRoot()).toBe(storageDir);
        });

        it("uses an absolute XDG data home when no upload path is configured", () => {
            vi.stubEnv("ASSET_STORAGE_DIR", "  ");
            vi.stubEnv("XDG_DATA_HOME", `  ${tempDir}  `);
            expect(getAssetStorageRoot()).toBe(join(tempDir, "basishacks", "assets"));
        });

        it("falls back to the home data directory for a relative XDG path", () => {
            vi.stubEnv("ASSET_STORAGE_DIR", "");
            vi.stubEnv("XDG_DATA_HOME", "relative-data");
            expect(getAssetStorageRoot()).toBe(
                join(homedir(), ".local", "share", "basishacks", "assets"),
            );
        });

        it("uses the home data directory when neither storage variable is set", () => {
            vi.stubEnv("ASSET_STORAGE_DIR", "");
            vi.stubEnv("XDG_DATA_HOME", "");
            expect(getAssetStorageRoot()).toBe(
                join(homedir(), ".local", "share", "basishacks", "assets"),
            );
        });

        it("permits a production storage directory outside the release tree", () => {
            vi.stubEnv("NODE_ENV", "production");
            expect(getAssetStorageRoot()).toBe(storageDir);
        });

        it("rejects a production storage root equal to the release root", () => {
            vi.stubEnv("NODE_ENV", "production");
            vi.stubEnv("ASSET_STORAGE_DIR", join(tempDir, "release"));
            expect(() => getAssetStorageRoot()).toThrow(
                "ASSET_STORAGE_DIR must be outside the application release directory in production",
            );
        });
    });

    describe("bounded and validated writes", () => {
        it("truncates an existing regular file and preserves its nested basename", async () => {
            await createAsset("nested/current.txt", Buffer.from("old content"));
            await expect(createAsset("nested/current.txt", Buffer.from("new"))).resolves.toBe(
                "current.txt",
            );
            await expect(readFile(join(assetsDir, "nested", "current.txt"), "utf8")).resolves.toBe(
                "new",
            );
        });

        it.each(["", "/", "a//b.txt", "a/./b.txt", "a/../b.txt", "a\\b.txt", "a\0b.txt"])(
            "rejects malformed name %j",
            async (name) => {
                await expect(createAsset(name, Buffer.from("x"))).rejects.toMatchObject({
                    statusCode: 400,
                });
            },
        );

        it("rejects names longer than the supported limit", async () => {
            await expect(createAsset("x".repeat(513), Buffer.from("x"))).rejects.toMatchObject({
                statusCode: 400,
            });
        });

        it("rejects an asset collection root that is itself a symlink", async () => {
            const outside = join(tempDir, "outside");
            await mkdir(outside);
            await mkdir(storageDir, { recursive: true });
            await symlink(outside, assetsDir, "junction");
            await expect(createAsset("outside.txt", Buffer.from("x"))).rejects.toMatchObject({
                statusCode: 500,
                statusMessage: "Asset storage is unavailable",
            });
        });

        it("refuses to overwrite a symlink target", async () => {
            const outsideFile = join(tempDir, "outside.txt");
            await writeFile(outsideFile, "keep me");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outsideFile, join(assetsDir, "linked.txt"), "file");

            await expect(createAsset("linked.txt", Buffer.from("overwrite"))).rejects.toMatchObject(
                {
                    statusCode: 400,
                    statusMessage: "Invalid asset path",
                },
            );
            await expect(readFile(outsideFile, "utf8")).resolves.toBe("keep me");
        });

        it("rejects an existing directory used as a file path", async () => {
            await mkdir(join(assetsDir, "directory"), { recursive: true });
            await expect(createAsset("directory", Buffer.from("x"))).rejects.toMatchObject({
                statusCode: 400,
            });
        });

        it("stores user files in the separate userassets collection", async () => {
            await expect(createUserAsset("avatar/data.bin", Buffer.from([0, 255]))).resolves.toBe(
                "data.bin",
            );
            await expect(readFile(join(userAssetsDir, "avatar", "data.bin"))).resolves.toEqual(
                Buffer.from([0, 255]),
            );
        });
    });

    describe("streamed uploads", () => {
        it("writes bounded chunks and preserves the complete byte sequence", async () => {
            const body = Buffer.from("0123456789abcdefpayload");
            const name = await createAssetFromStream(
                "uploads/split.bin",
                Readable.from([body.subarray(0, 5), body.subarray(5, 13), body.subarray(13)]),
                body.length,
            );
            expect(name).toBe("split.bin");
            await expect(readFile(join(assetsDir, "uploads", name))).resolves.toEqual(body);
        });

        it("accepts a valid image signature split across chunks and passes its 16-byte prefix", async () => {
            const body = Buffer.from("GIF89a0123456789-image-data");
            const seen: Buffer[] = [];
            const name = await createAssetFromStream(
                "images/example.gif",
                Readable.from([body.subarray(0, 2), body.subarray(2, 7), body.subarray(7)]),
                body.length,
                (prefix) => {
                    seen.push(Buffer.from(prefix));
                    return prefix.subarray(0, 3).toString("ascii") === "GIF";
                },
            );
            expect(name).toBe("example.gif");
            expect(seen).toHaveLength(1);
            expect(seen[0]).toEqual(body.subarray(0, 16));
            await expect(readFile(join(assetsDir, "images", name))).resolves.toEqual(body);
        });

        it("rejects truncated content even when its partial prefix matches a signature", async () => {
            const body = Buffer.from("GIF89a");
            await expect(
                createAssetFromStream(
                    "short.gif",
                    Readable.from([body.subarray(0, 2), body.subarray(2)]),
                    body.length,
                    (prefix) => prefix.toString("ascii").startsWith("GIF"),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
            await expect(readdir(assetsDir)).resolves.toEqual([]);
        });

        it("allows string chunks and a caller-selected user asset collection", async () => {
            await createAssetFromStream(
                "text.txt",
                Readable.from(["0123456789abcdef", "tail"]),
                20,
                undefined,
                "userassets",
            );
            await expect(readFile(join(userAssetsDir, "text.txt"), "utf8")).resolves.toBe(
                "0123456789abcdeftail",
            );
        });

        it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
            "rejects invalid byte limit %s",
            async (limit) => {
                await expect(
                    createAssetFromStream("bad-limit.bin", Readable.from([]), limit),
                ).rejects.toThrow("maxBytes must be a positive safe integer");
            },
        );

        it("rejects over-limit data with status 413 and removes its temporary file", async () => {
            await createAsset("uploads/existing.bin", Buffer.from("original"));
            await expect(
                createAssetFromStream(
                    "uploads/existing.bin",
                    Readable.from([Buffer.from("123456"), Buffer.from("789")]),
                    8,
                ),
            ).rejects.toMatchObject({ statusCode: 413, statusMessage: "File too large" });
            await expect(
                readFile(join(assetsDir, "uploads", "existing.bin"), "utf8"),
            ).resolves.toBe("original");
            expect(
                (await readdir(join(assetsDir, "uploads"))).filter((name) => name.endsWith(".tmp")),
            ).toEqual([]);
        });

        it("rejects an invalid 16-byte signature and removes the temporary file", async () => {
            await expect(
                createAssetFromStream(
                    "invalid.png",
                    Readable.from([Buffer.from("not an image signature")]),
                    64,
                    (prefix) =>
                        prefix
                            .subarray(0, 8)
                            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
                ),
            ).rejects.toMatchObject({ statusCode: 400, statusMessage: "Invalid file content" });
            expect(await readdir(assetsDir)).toEqual([]);
        });

        it("rejects an incomplete invalid signature during stream flush", async () => {
            await expect(
                createAssetFromStream(
                    "incomplete.png",
                    Readable.from([Buffer.from("short")]),
                    64,
                    (prefix) => prefix.length >= 8,
                ),
            ).rejects.toMatchObject({ statusCode: 400, statusMessage: "Invalid file content" });
            expect(await readdir(assetsDir)).toEqual([]);
        });

        it("propagates source stream errors and cleans up partial output", async () => {
            async function* brokenSource() {
                yield Buffer.from("partial");
                throw new Error("source failed");
            }
            await expect(
                createAssetFromStream("broken.bin", Readable.from(brokenSource()), 32),
            ).rejects.toThrow("source failed");
            expect(await readdir(assetsDir)).toEqual([]);
        });

        it("does not replace a destination symlink", async () => {
            const outsideFile = join(tempDir, "stream-outside.txt");
            await writeFile(outsideFile, "preserve");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outsideFile, join(assetsDir, "linked.txt"), "file");
            await expect(
                createAssetFromStream(
                    "linked.txt",
                    Readable.from([Buffer.from("replacement")]),
                    32,
                ),
            ).rejects.toMatchObject({ statusCode: 400, statusMessage: "Invalid asset path" });
            await expect(readFile(outsideFile, "utf8")).resolves.toBe("preserve");
            expect((await readdir(assetsDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
        });

        it("atomically replaces a regular destination file", async () => {
            await createAsset("replace.txt", Buffer.from("before"));
            await createAssetFromStream("replace.txt", Readable.from([Buffer.from("after")]), 5);
            await expect(readFile(join(assetsDir, "replace.txt"), "utf8")).resolves.toBe("after");
        });
    });

    describe("asset listing and deletion", () => {
        it("lists only visible regular files in sorted order", async () => {
            await mkdir(assetsDir, { recursive: true });
            await writeFile(join(assetsDir, "z.txt"), "z");
            await writeFile(join(assetsDir, "a.txt"), "a");
            await writeFile(join(assetsDir, ".hidden"), "hidden");
            await mkdir(join(assetsDir, "folder"));
            await expect(getStoredAssetNames("assets")).resolves.toEqual(["a.txt", "z.txt"]);
        });

        it("lists only direct files from a selected nested collection directory", async () => {
            await createAsset("uploads/one.txt", Buffer.from("1"));
            await createAsset("uploads/two.txt", Buffer.from("2"));
            await createAsset("elsewhere.txt", Buffer.from("3"));
            await expect(getStoredAssetNames("assets", "uploads")).resolves.toEqual([
                "one.txt",
                "two.txt",
            ]);
        });

        it("returns an empty list for missing roots or subdirectories", async () => {
            await expect(getStoredAssetNames("assets")).resolves.toEqual([]);
            await expect(getStoredAssetNames("userassets", "missing")).resolves.toEqual([]);
        });

        it("rejects unsafe subdirectory names and propagates non-ENOENT listing errors", async () => {
            await expect(getStoredAssetNames("assets", "../outside")).rejects.toMatchObject({
                statusCode: 400,
            });
            await createAsset("ordinary.txt", Buffer.from("file"));
            await expect(getStoredAssetNames("assets", "ordinary.txt")).rejects.toThrow();
        });

        it("deletes a symlink entry without deleting its external target", async () => {
            const outsideFile = join(tempDir, "delete-outside.txt");
            await writeFile(outsideFile, "untouched");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outsideFile, join(assetsDir, "link.txt"), "file");
            await removeAsset("link.txt");
            await expect(lstat(outsideFile)).resolves.toBeDefined();
            await expect(readFile(outsideFile, "utf8")).resolves.toBe("untouched");
        });

        it("does not delete files reached through a symlinked parent directory", async () => {
            const outside = join(tempDir, "external-directory");
            await mkdir(outside);
            await writeFile(join(outside, "keep.txt"), "untouched");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outside, join(assetsDir, "external"), "junction");

            await expect(removeAsset("external/keep.txt")).rejects.toMatchObject({
                statusCode: 404,
            });
            await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("untouched");
        });

        it("propagates deletion errors other than missing files", async () => {
            await mkdir(join(assetsDir, "directory"), { recursive: true });
            await expect(removeAsset("directory")).rejects.toThrow();
        });

        it("removes user assets without affecting same-named public assets", async () => {
            await createAsset("same.txt", Buffer.from("public"));
            await createUserAsset("same.txt", Buffer.from("private"));
            await removeUserAsset("same.txt");
            await expect(readFile(join(assetsDir, "same.txt"), "utf8")).resolves.toBe("public");
            await expect(lstat(join(userAssetsDir, "same.txt"))).rejects.toMatchObject({
                code: "ENOENT",
            });
        });
    });

    describe("asset reads", () => {
        it("returns a stream and byte size for a public asset", async () => {
            const expected = Buffer.from([0, 1, 127, 255]);
            await createAsset("download.bin", expected);
            const asset = await openStoredAsset("assets", "download.bin");
            const chunks: Buffer[] = [];
            for await (const chunk of asset.stream) chunks.push(Buffer.from(chunk));
            expect(asset.size).toBe(expected.length);
            expect(Buffer.concat(chunks)).toEqual(expected);
        });

        it("returns 404 for directory and symbolic-link entries", async () => {
            await mkdir(join(assetsDir, "directory"), { recursive: true });
            await expect(openStoredAsset("assets", "directory")).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Asset not found",
            });

            const outsideFile = join(tempDir, "read-outside.txt");
            await writeFile(outsideFile, "outside");
            await symlink(outsideFile, join(assetsDir, "linked.txt"), "file");
            await expect(openStoredAsset("assets", "linked.txt")).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Asset not found",
            });
        });

        it("does not read through a symlinked parent directory", async () => {
            const outside = join(tempDir, "external-directory");
            await mkdir(outside);
            await writeFile(join(outside, "secret.txt"), "outside storage");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outside, join(assetsDir, "external"), "junction");

            await expect(openStoredAsset("assets", "external/secret.txt")).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Asset not found",
            });
        });

        it("does not list names through a symlinked collection directory", async () => {
            const outside = join(tempDir, "external-directory");
            await mkdir(outside);
            await writeFile(join(outside, "secret-name.txt"), "outside storage");
            await mkdir(assetsDir, { recursive: true });
            await symlink(outside, join(assetsDir, "external"), "junction");

            await expect(getStoredAssetNames("assets", "external")).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: "Asset not found",
            });
        });

        it("rejects traversal and exposes missing-file errors from the file system", async () => {
            await expect(openStoredAsset("assets", "../secret.txt")).rejects.toMatchObject({
                statusCode: 400,
            });
            await expect(openStoredAsset("assets", "missing.txt")).rejects.toMatchObject({
                code: "ENOENT",
            });
        });

        it("returns complete user asset content and preserves empty-file behavior", async () => {
            await createUserAsset("nested/empty.bin", Buffer.alloc(0));
            await expect(getUserAsset("nested/empty.bin")).resolves.toEqual(Buffer.alloc(0));
        });
    });

    describe("content metadata", () => {
        it.each([
            ["file.GIF", "image/gif"],
            ["file.jpeg", "image/jpeg"],
            ["file.JPG", "image/jpeg"],
            ["file.json", "application/json; charset=utf-8"],
            ["file.md", "text/markdown; charset=utf-8"],
            ["file.mp4", "video/mp4"],
            ["file.pdf", "application/pdf"],
            ["file.png", "image/png"],
            ["file.txt", "text/plain; charset=utf-8"],
            ["file.webp", "image/webp"],
            ["file.zip", "application/zip"],
            ["file.unknown", "application/octet-stream"],
            ["no-extension", "application/octet-stream"],
        ])("maps %s to %s", (name, contentType) => {
            expect(assetContentType(name)).toBe(contentType);
        });

        it.each(["a.gif", "a.jpeg", "a.jpg", "a.mp4", "a.png", "a.webp", "A.PNG"])(
            "allows inline display for %s",
            (name) => expect(isInlineSafeAsset(name)).toBe(true),
        );

        it.each(["a.json", "a.md", "a.pdf", "a.txt", "a.zip", "a.bin", "no-extension"])(
            "keeps %s out of inline display",
            (name) => expect(isInlineSafeAsset(name)).toBe(false),
        );
    });
});
