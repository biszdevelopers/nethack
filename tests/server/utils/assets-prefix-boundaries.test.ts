import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { createAssetFromStream } from "~~/server/utils/assets";

describe("streamed asset prefix boundaries", () => {
    let tempDir: string;
    let storageDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "asset-prefix-boundaries-"));
        storageDir = join(tempDir, "persistent");
        vi.stubEnv("ASSET_STORAGE_DIR", storageDir);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(tempDir, { recursive: true, force: true });
    });

    it("validates signatures split across chunks and preserves each chunk remainder", async () => {
        const signature = Buffer.from("0123456789abcdef");
        const overflowChunk = Buffer.concat([signature.subarray(5), Buffer.from("TAIL")]);

        await createAssetFromStream(
            "split-prefix.txt",
            Readable.from([signature.subarray(0, 5), overflowChunk, Buffer.from("more")]),
            64,
            (prefix) => prefix.equals(signature),
        );

        await expect(readFile(join(storageDir, "assets", "split-prefix.txt"))).resolves.toEqual(
            Buffer.concat([signature, Buffer.from("TAILmore")]),
        );
    });

    it("accepts string chunks while validating a signature", async () => {
        const signature = Buffer.from("0123456789abcdef");

        await createAssetFromStream(
            "string-prefix.txt",
            Readable.from(["01234", "56789abcdefTAIL", "more"]),
            64,
            (prefix) => prefix.equals(signature),
        );

        await expect(readFile(join(storageDir, "assets", "string-prefix.txt"))).resolves.toEqual(
            Buffer.concat([signature, Buffer.from("TAILmore")]),
        );
    });
});
