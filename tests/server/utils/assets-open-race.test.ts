import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    open: openMock,
}));

import { createAsset, openStoredAsset } from "~~/server/utils/assets";

describe("asset file replacement race", () => {
    let tempDir: string;
    let storageDir: string;
    let actualFsPromises: typeof import("node:fs/promises");
    const close = vi.fn();

    beforeEach(async () => {
        actualFsPromises =
            await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        tempDir = await actualFsPromises.mkdtemp(join(tmpdir(), "asset-open-race-"));
        storageDir = join(tempDir, "persistent");
        await actualFsPromises.mkdir(join(storageDir, "assets"), { recursive: true });
        await actualFsPromises.writeFile(join(storageDir, "assets", "file.txt"), "regular file");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
        close.mockReset();
        openMock.mockReset().mockResolvedValue({
            stat: async () => ({ isFile: () => false }),
            close,
        });
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await actualFsPromises.rm(tempDir, { recursive: true, force: true });
    });

    it("closes a handle when the opened path is no longer a regular file", async () => {
        await expect(openStoredAsset("assets", "file.txt")).rejects.toMatchObject({
            statusCode: 404,
            statusMessage: "Asset not found",
        });

        expect(openMock).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it("closes a write handle when the opened destination is not a regular file", async () => {
        await expect(createAsset("file.txt", Buffer.from("replacement"))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid asset path",
        });

        expect(openMock).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });
});
