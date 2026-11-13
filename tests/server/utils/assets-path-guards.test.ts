import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { controls } = vi.hoisted(() => ({
    controls: {
        relativeMode: "",
        realpathMode: "",
        mkdirFailurePath: "",
        lstatFailurePath: "",
    },
}));

vi.mock("node:path", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:path")>();
    return {
        ...actual,
        relative: (from: string, to: string) => {
            const isAssetsDirectory = String(from).endsWith(`${actual.sep}assets`);
            if (controls.relativeMode === "resolve-escape" && isAssetsDirectory) {
                controls.relativeMode = "";
                return `..${actual.sep}outside`;
            }
            if (controls.relativeMode === "remove-escape" && from === to && isAssetsDirectory) {
                controls.relativeMode = "";
                return `..${actual.sep}outside`;
            }
            return actual.relative(from, to);
        },
    };
});

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    const realpathSyncMock = Object.assign(
        (...args: Parameters<typeof actual.realpathSync>) => actual.realpathSync(...args),
        {
            ...actual.realpathSync,
            native: (path: string, ...args: unknown[]) => {
                if (controls.realpathMode) {
                    const code = controls.realpathMode === "eacces" ? "EACCES" : "ENOENT";
                    throw Object.assign(new Error(`forced ${code}`), { code });
                }
                return actual.realpathSync.native(path, ...(args as []));
            },
        },
    );
    return { ...actual, realpathSync: realpathSyncMock };
});

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        mkdir: async (path: string, options?: Parameters<typeof actual.mkdir>[1]) => {
            if (path === controls.mkdirFailurePath) {
                throw Object.assign(new Error("forced mkdir failure"), { code: "ENOSPC" });
            }
            return actual.mkdir(path, options);
        },
        lstat: async (path: string, ...args: unknown[]) => {
            if (path === controls.lstatFailurePath) {
                throw Object.assign(new Error("forced lstat failure"), { code: "EACCES" });
            }
            return actual.lstat(path, ...(args as []));
        },
    };
});

import { getAssetStorageRoot, createAsset, removeAsset } from "~~/server/utils/assets";

describe("asset path and filesystem guard failures", () => {
    let tempDir: string;
    let storageDir: string;
    let actualFs: typeof import("node:fs/promises");

    beforeEach(async () => {
        actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        tempDir = await actualFs.mkdtemp(join(tmpdir(), "asset-path-guards-"));
        storageDir = join(tempDir, "persistent");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
        vi.stubEnv("NODE_ENV", "test");
        Object.assign(controls, {
            relativeMode: "",
            realpathMode: "",
            mkdirFailurePath: "",
            lstatFailurePath: "",
        });
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await actualFs.rm(tempDir, { recursive: true, force: true });
    });

    it("rethrows non-missing configured-path canonicalization errors", () => {
        controls.realpathMode = "eacces";
        vi.stubEnv("NODE_ENV", "production");

        expect(() => getAssetStorageRoot()).toThrow("forced EACCES");
    });

    it("stops configured-path canonicalization at the filesystem root", () => {
        controls.realpathMode = "enoent";
        vi.stubEnv("NODE_ENV", "production");

        expect(() => getAssetStorageRoot()).toThrow("forced ENOENT");
    });

    it("rejects a resolved asset path outside its collection", async () => {
        controls.relativeMode = "resolve-escape";

        await expect(createAsset("safe.txt", Buffer.from("data"))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid asset name",
        });
    });

    it("propagates nested-directory creation failures", async () => {
        controls.mkdirFailurePath = join(storageDir, "assets", "nested");

        await expect(createAsset("nested/file.txt", Buffer.from("data"))).rejects.toMatchObject({
            code: "ENOSPC",
        });
    });

    it("rejects directory containment failures before checking symlinks", async () => {
        controls.relativeMode = "remove-escape";

        await expect(removeAsset("file.txt")).rejects.toMatchObject({
            statusCode: 404,
            statusMessage: "Asset not found",
        });
    });

    it("propagates non-missing errors while checking directories", async () => {
        const nestedDirectory = join(storageDir, "assets", "nested");
        await actualFs.mkdir(nestedDirectory, { recursive: true });
        controls.lstatFailurePath = nestedDirectory;

        await expect(removeAsset("nested/file.txt")).rejects.toMatchObject({ code: "EACCES" });
    });
});
