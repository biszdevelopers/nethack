import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { rmMock } = vi.hoisted(() => ({ rmMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    rm: rmMock,
}));

import { createAssetFromStream } from "~~/server/utils/assets";

describe("atomic asset publication cleanup", () => {
    let tempDir: string;
    let storageDir: string;
    let actualFsPromises: typeof import("node:fs/promises");

    beforeEach(async () => {
        actualFsPromises =
            await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        tempDir = await actualFsPromises.mkdtemp(join(tmpdir(), "asset-publish-cleanup-"));
        storageDir = join(tempDir, "persistent");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
        rmMock.mockReset().mockImplementation(actualFsPromises.rm);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await actualFsPromises.rm(tempDir, { recursive: true, force: true });
    });

    it("retains safely published bytes if temporary cleanup fails", async () => {
        let calls = 0;
        rmMock.mockImplementation(async (...args: Parameters<typeof actualFsPromises.rm>) => {
            calls += 1;
            if (calls <= 3) throw new Error("temporary unlink failed");
            return actualFsPromises.rm(...args);
        });

        await expect(
            createAssetFromStream(
                "exclusive.txt",
                Readable.from([Buffer.from("bounded asset")]),
                32,
                undefined,
                "assets",
                false,
            ),
        ).rejects.toThrow("temporary unlink failed");

        expect(calls).toBe(2);
        await expect(actualFsPromises.readdir(join(storageDir, "assets"))).resolves.toEqual(
            expect.arrayContaining(["exclusive.txt"]),
        );
    });
});
