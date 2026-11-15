import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

const { linkMock } = vi.hoisted(() => ({ linkMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    link: linkMock,
}));

import { createAssetFromStream } from "~~/server/utils/assets";

describe("asset publication without replacement", () => {
    let tempDir: string;
    let assetsDir: string;
    let actualFsPromises: typeof import("node:fs/promises");

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "asset-no-replace-"));
        assetsDir = join(tempDir, "persistent", "assets");
        vi.stubEnv("ASSET_STORAGE_DIR", join(tempDir, "persistent"));
        linkMock.mockReset();
        actualFsPromises =
            await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it("fails atomically if a destination appears after the initial path check", async () => {
        const concurrentAsset = Buffer.from("concurrent upload wins");
        linkMock.mockImplementation(async (source: string, destination: string) => {
            await actualFsPromises.writeFile(destination, concurrentAsset, { flag: "wx" });
            return actualFsPromises.link(source, destination);
        });

        await expect(
            createAssetFromStream(
                "collision.txt",
                Readable.from([Buffer.from("incoming upload")]),
                64,
                undefined,
                "assets",
                false,
            ),
        ).rejects.toMatchObject({ code: "EEXIST" });

        expect(linkMock).toHaveBeenCalledTimes(1);
        await expect(readFile(join(assetsDir, "collision.txt"))).resolves.toEqual(concurrentAsset);
        const remainingFiles = await readdir(assetsDir);
        expect(remainingFiles).toEqual(["collision.txt"]);
    });
});
