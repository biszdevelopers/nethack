import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteUnreferencedProfileAsset } from "~~/server/utils/assets";

let storageRoot: string;

function transactionReturning(rows: unknown[][]) {
    let call = 0;
    return {
        select: vi.fn(() => ({
            from: () => ({
                where: () => ({
                    limit: async () => rows[call++] ?? [],
                }),
            }),
        })),
    } as any;
}

beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "basishacks-assets-"));
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ASSET_STORAGE_DIR", storageRoot);
});

afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(storageRoot, { recursive: true, force: true });
});

const managedPath = (bytes: Buffer) =>
    `profiles/${createHash("sha256").update(bytes).digest("hex")}.png`;

async function seedAsset(bytes: Buffer) {
    const path = managedPath(bytes);
    const directory = join(storageRoot, "userassets", "profiles");
    await mkdir(directory, { recursive: true });
    const file = join(directory, path.split("/")[1]!);
    await writeFile(file, bytes);
    return { path, file };
}

describe("superseded profile asset cleanup", () => {
    it("removes an unreferenced image immediately", async () => {
        const { path, file } = await seedAsset(Buffer.from("old-avatar"));

        await expect(
            deleteUnreferencedProfileAsset(transactionReturning([[], [], []]), path),
        ).resolves.toBe(true);
        expect(existsSync(file)).toBe(false);
    });

    it("keeps an image that another user still references", async () => {
        const { path, file } = await seedAsset(Buffer.from("shared-avatar"));

        await expect(
            deleteUnreferencedProfileAsset(transactionReturning([[{ id: 2 }]]), path),
        ).resolves.toBe(false);
        expect(existsSync(file)).toBe(true);
    });

    it("keeps an image registered as an asset reference or pinned object", async () => {
        const { path, file } = await seedAsset(Buffer.from("registered-avatar"));

        await expect(
            deleteUnreferencedProfileAsset(transactionReturning([[], [{ id: 9 }]]), path),
        ).resolves.toBe(false);
        await expect(
            deleteUnreferencedProfileAsset(transactionReturning([[], [], [{ id: 9 }]]), path),
        ).resolves.toBe(false);
        expect(existsSync(file)).toBe(true);
    });

    it("ignores paths outside the managed profile namespace", async () => {
        const transaction = transactionReturning([[], [], []]);

        await expect(
            deleteUnreferencedProfileAsset(transaction, "profiles/not-a-digest.png"),
        ).resolves.toBe(false);
        await expect(deleteUnreferencedProfileAsset(transaction, null)).resolves.toBe(false);
        expect(transaction.select).not.toHaveBeenCalled();
    });
});
