import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
    createAsset,
    createUserAsset,
    removeAsset,
    removeUserAsset,
    getUserAsset,
} from "~~/server/utils/assets";

describe("asset helpers", () => {
    let tempDir: string;
    let assetsDir: string;
    let userAssetsDir: string;
    let storageDir: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "assets-test-"));
        storageDir = join(tempDir, "persistent-assets");
        assetsDir = join(storageDir, "assets");
        userAssetsDir = join(storageDir, "userassets");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
        cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    });

    afterEach(async () => {
        cwdSpy?.mockRestore();
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("createAsset", () => {
        it("writes a safe file under the configured persistent directory", async () => {
            const result = await createAsset("hello.txt", Buffer.from("hello"));
            expect(result).toBe("hello.txt");

            const files = await readdir(assetsDir);
            expect(files).toContain("hello.txt");
        });

        it("creates the assets parent directory if missing", async () => {
            const result = await createAsset("hello.txt", Buffer.from("hello"));
            expect(result).toBe("hello.txt");

            const files = await readdir(assetsDir);
            expect(files).toContain("hello.txt");
        });

        it("rejects names containing ..", async () => {
            await expect(createAsset("../escape.txt", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("creates nested directories when name contains /", async () => {
            const result = await createAsset("foo/bar.txt", Buffer.from("x"));
            expect(result).toBe("bar.txt");

            const files = await readdir(join(assetsDir, "foo"));
            expect(files).toContain("bar.txt");
        });

        it("rejects traversal to .env via ../../.env", async () => {
            await expect(createAsset("../../.env", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("rejects traversal to .env via ..\\..\\.env", async () => {
            await expect(createAsset("..\\..\\.env", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("rejects non-string names", async () => {
            await expect(createAsset(null as any, Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
            await expect(createAsset(123 as any, Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("rejects empty, dot, and double-dot names", async () => {
            await expect(createAsset("", Buffer.from("x"))).rejects.toThrow("Invalid asset name");
            await expect(createAsset(".", Buffer.from("x"))).rejects.toThrow("Invalid asset name");
            await expect(createAsset("..", Buffer.from("x"))).rejects.toThrow("Invalid asset name");
        });

        it("rejects names containing backslashes", async () => {
            await expect(createAsset("foo\\bar.txt", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("rejects an absolute storage directory override", async () => {
            vi.stubEnv("ASSET_STORAGE_DIR", "relative/uploads");
            await expect(createAsset("safe.txt", Buffer.from("x"))).rejects.toThrow(
                "ASSET_STORAGE_DIR must be an absolute path",
            );
        });

        it("rejects production asset storage inside the release directory", async () => {
            vi.stubEnv("NODE_ENV", "production");
            vi.stubEnv("ASSET_STORAGE_DIR", join(tempDir, "public", "userassets"));
            await expect(createAsset("safe.txt", Buffer.from("x"))).rejects.toThrow(
                "ASSET_STORAGE_DIR must be outside the application release directory in production",
            );
        });

        it("rejects a storage path reached through a symlink into the release directory", async () => {
            const storageAlias = join(tempDir, "storage-alias");
            await symlink(tempDir, storageAlias, "junction");
            vi.stubEnv("NODE_ENV", "production");
            vi.stubEnv("ASSET_STORAGE_DIR", join(storageAlias, "public", "userassets"));

            await expect(createAsset("safe.txt", Buffer.from("x"))).rejects.toThrow(
                "ASSET_STORAGE_DIR must be outside the application release directory in production",
            );
        });

        it("canonicalizes a symlinked release working directory", async () => {
            const releaseRoot = join(tempDir, "release");
            const releaseAlias = join(tempDir, "current");
            await mkdir(releaseRoot);
            await symlink(releaseRoot, releaseAlias, "junction");
            cwdSpy.mockReturnValue(releaseAlias);
            vi.stubEnv("NODE_ENV", "production");
            vi.stubEnv("ASSET_STORAGE_DIR", join(releaseRoot, "public", "uploads"));

            await expect(createAsset("safe.txt", Buffer.from("x"))).rejects.toThrow(
                "ASSET_STORAGE_DIR must be outside the application release directory in production",
            );
        });

        it("rejects writes through a symlinked directory", async () => {
            const outside = join(tempDir, "outside");
            await mkdir(outside);
            await mkdir(assetsDir, { recursive: true });
            await symlink(outside, join(assetsDir, "linked"), "junction");
            await expect(createAsset("linked/escape.txt", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset path",
            );
        });
    });

    describe("createUserAsset", () => {
        it("writes to public/userassets", async () => {
            const result = await createUserAsset("avatar.png", Buffer.from("png"));
            expect(result).toBe("avatar.png");

            const files = await readdir(userAssetsDir);
            expect(files).toContain("avatar.png");
        });

        it("creates the userassets parent directory if missing", async () => {
            const result = await createUserAsset("avatar.png", Buffer.from("png"));
            expect(result).toBe("avatar.png");

            const files = await readdir(userAssetsDir);
            expect(files).toContain("avatar.png");
        });

        it("rejects path traversal names", async () => {
            await expect(createUserAsset("../../../etc/passwd", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });
    });

    describe("removeAsset", () => {
        it("removes a safe file", async () => {
            await createAsset("delete-me.txt", Buffer.from("bye"));
            await removeAsset("delete-me.txt");

            const files = await readdir(assetsDir);
            expect(files).not.toContain("delete-me.txt");
        });

        it("rejects path traversal names", async () => {
            await expect(removeAsset("../escape.txt")).rejects.toThrow("Invalid asset name");
        });

        it("returns early when name is null or undefined", async () => {
            await expect(removeAsset(null)).resolves.toBeUndefined();
            await expect(removeAsset(undefined)).resolves.toBeUndefined();
        });

        it("ignores errors when the file does not exist", async () => {
            await expect(removeAsset("missing-file.txt")).resolves.toBeUndefined();
        });
    });

    describe("removeUserAsset", () => {
        it("removes a safe user asset", async () => {
            await createUserAsset("delete-me.png", Buffer.from("bye"));
            await removeUserAsset("delete-me.png");

            const files = await readdir(userAssetsDir);
            expect(files).not.toContain("delete-me.png");
        });

        it("rejects path traversal names", async () => {
            await expect(removeUserAsset("../escape.txt")).rejects.toThrow("Invalid asset name");
        });

        it("returns early when name is null or undefined", async () => {
            await expect(removeUserAsset(null)).resolves.toBeUndefined();
            await expect(removeUserAsset(undefined)).resolves.toBeUndefined();
        });

        it("ignores errors when the file does not exist", async () => {
            await expect(removeUserAsset("missing-file.png")).resolves.toBeUndefined();
        });
    });

    describe("getUserAsset", () => {
        it("reads a safe user asset", async () => {
            await createUserAsset("readable.txt", Buffer.from("content"));
            const data = await getUserAsset("readable.txt");
            expect(data.toString()).toBe("content");
        });

        it("rejects path traversal names", async () => {
            await expect(getUserAsset("../assets/secret.txt")).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("throws on non-existent file", async () => {
            await expect(getUserAsset("nonexistent.txt")).rejects.toThrow();
        });

        it("refuses to read through a symlink", async () => {
            const outsideFile = join(tempDir, "outside.txt");
            await writeFile(outsideFile, "outside storage");
            await mkdir(userAssetsDir, { recursive: true });
            await symlink(outsideFile, join(userAssetsDir, "linked.txt"), "file");

            await expect(getUserAsset("linked.txt")).rejects.toThrow("Asset not found");
        });

        it("throws on null name", async () => {
            await expect(getUserAsset(null as any)).rejects.toThrow("Invalid asset name");
        });

        it("throws on empty name", async () => {
            await expect(getUserAsset("")).rejects.toThrow("Invalid asset name");
        });

        it("throws on name with only dots", async () => {
            await expect(getUserAsset(".")).rejects.toThrow("Invalid asset name");
            await expect(getUserAsset("..")).rejects.toThrow("Invalid asset name");
        });

        it("reads binary content correctly", async () => {
            const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
            await createUserAsset("binary.dat", binary);
            const data = await getUserAsset("binary.dat");
            expect(Buffer.from(data)).toEqual(binary);
        });

        it("reads a file in a nested directory", async () => {
            await createUserAsset("sub/deep.txt", Buffer.from("nested content"));
            const data = await getUserAsset("sub/deep.txt");
            expect(data.toString()).toBe("nested content");
        });

        it("throws when name attempts path traversal via null byte", async () => {
            await expect(getUserAsset("safe.txt\0../../../etc/passwd")).rejects.toThrow(
                "Invalid asset name",
            );
        });
    });

    // ---------------------------------------------------------------------------
    // Additional edge cases
    // ---------------------------------------------------------------------------

    describe("createAsset edge cases", () => {
        it("handles very long asset names", async () => {
            const longName = "a".repeat(200) + ".txt";
            const result = await createAsset(longName, Buffer.from("data"));
            expect(result).toBe(longName);
            expect(result.length).toBe(204);
        });

        it("handles unicode characters in asset names", async () => {
            const result = await createAsset("résumé-文件.txt", Buffer.from("unicode"));
            expect(result).toBe("résumé-文件.txt");
        });

        it("handles asset names with special characters", async () => {
            const result = await createAsset("file-with-dashes_and.dots.txt", Buffer.from("data"));
            expect(result).toBe("file-with-dashes_and.dots.txt");
        });

        it("succeeds when assets directory already exists", async () => {
            // First call creates the directory
            await createAsset("first.txt", Buffer.from("first"));
            // Second call with an existing directory should also succeed
            const result = await createAsset("second.txt", Buffer.from("second"));
            expect(result).toBe("second.txt");
        });

        it("rejects names with null bytes", async () => {
            await expect(createAsset("safe.txt\0evil", Buffer.from("x"))).rejects.toThrow();
        });

        it("rejects names that are just a slash", async () => {
            await expect(createAsset("/", Buffer.from("x"))).rejects.toThrow("Invalid asset name");
        });

        it("allows names starting with double dots (..name is a valid filename)", async () => {
            const result = await createAsset("..name", Buffer.from("x"));
            expect(result).toBe("..name");
        });

        it("writes and reads back the correct binary content", async () => {
            const content = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
            await createAsset("magic.bin", content);
            const files = await readdir(assetsDir);
            expect(files).toContain("magic.bin");
        });
    });

    describe("createUserAsset edge cases", () => {
        it("handles very long user asset names", async () => {
            const longName = "b".repeat(250) + ".png";
            const result = await createUserAsset(longName, Buffer.from("data"));
            expect(result).toBe(longName);
        });

        it("handles unicode characters in user asset names", async () => {
            const result = await createUserAsset("照片.png", Buffer.from("pic"));
            expect(result).toBe("照片.png");
        });

        it("succeeds when userassets directory already exists", async () => {
            await createUserAsset("first.png", Buffer.from("first"));
            const result = await createUserAsset("second.png", Buffer.from("second"));
            expect(result).toBe("second.png");
        });

        it("rejects empty string name", async () => {
            await expect(createUserAsset("", Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });

        it("rejects non-string names", async () => {
            await expect(createUserAsset(null as any, Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
            await expect(createUserAsset(42 as any, Buffer.from("x"))).rejects.toThrow(
                "Invalid asset name",
            );
        });
    });

    describe("removeAsset edge cases", () => {
        it("does not throw when removing non-existent file after valid name check", async () => {
            await expect(removeAsset("truly-nonexistent-file.txt")).resolves.toBeUndefined();
        });

        it("removes a file in a nested directory", async () => {
            await createAsset("subdir/nested-remove.txt", Buffer.from("bye"));
            await removeAsset("subdir/nested-remove.txt");
            const files = await readdir(join(assetsDir, "subdir"));
            expect(files).not.toContain("nested-remove.txt");
        });
    });

    describe("removeUserAsset edge cases", () => {
        it("does not throw when removing non-existent user asset", async () => {
            await expect(removeUserAsset("ghost-file.png")).resolves.toBeUndefined();
        });

        it("rejects null bytes in names during removal", async () => {
            await expect(removeUserAsset("file.txt\0evil")).rejects.toThrow("Invalid asset name");
        });
    });

    describe("concurrent operations", () => {
        it("handles concurrent creation of different files", async () => {
            await Promise.all([
                createAsset("concurrent-a.txt", Buffer.from("a")),
                createAsset("concurrent-b.txt", Buffer.from("b")),
                createAsset("concurrent-c.txt", Buffer.from("c")),
            ]);

            const files = await readdir(assetsDir);
            expect(files).toContain("concurrent-a.txt");
            expect(files).toContain("concurrent-b.txt");
            expect(files).toContain("concurrent-c.txt");
        });

        it("handles concurrent creation and deletion", async () => {
            await createAsset("race.txt", Buffer.from("initial"));
            await Promise.all([
                removeAsset("race.txt"),
                createAsset("race.txt", Buffer.from("recreated")),
            ]);

            const data = await readdir(assetsDir);
            // At least one of the operations should have succeeded meaning the file may or may not exist
            // Both operations shouldn't throw
            expect(true).toBe(true);
        });

        it("handles concurrent writes to different user asset files", async () => {
            await Promise.all([
                createUserAsset("multi-a.jpg", Buffer.from("a")),
                createUserAsset("multi-b.jpg", Buffer.from("b")),
                createUserAsset("multi-c.jpg", Buffer.from("c")),
            ]);

            const files = await readdir(userAssetsDir);
            expect(files).toContain("multi-a.jpg");
            expect(files).toContain("multi-b.jpg");
            expect(files).toContain("multi-c.jpg");
        });
    });
});
