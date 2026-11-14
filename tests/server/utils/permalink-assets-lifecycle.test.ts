import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lstatFault = vi.hoisted(() => ({ path: "", code: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        lstat: async (...args: Parameters<typeof actual.lstat>) => {
            if (String(args[0]) === lstatFault.path) {
                const code = lstatFault.code;
                lstatFault.path = "";
                lstatFault.code = "";
                throw Object.assign(new Error(`simulated ${code}`), { code });
            }
            return actual.lstat(...args);
        },
    };
});
import type { DrizzleDatabase } from "~~/server/database";
import { assetObjects, assetReferences } from "~~/server/database/schema";
import {
    collectOrphanPermalinkAssets,
    createAsset,
    getAssetStorageRoot,
    publishStagedAssetContentAddressed,
    releaseAssetReference,
    stageAssetFromStream,
} from "~~/server/utils/assets";

const DAY_MS = 24 * 60 * 60 * 1000;
const dialect = new PgDialect();

interface AssetObject {
    collection: "assets" | "userassets";
    asset_path: string;
    sha256: string;
    byte_size: number;
    pinned: boolean;
    unreferenced_at: Date | null;
}

interface AssetReference {
    id: string;
    collection: "assets" | "userassets";
    asset_path: string;
    reference_type: "permalink";
    created_by: number;
}

function fakeDatabase(options: { beforeLock?: () => void } = {}) {
    const objects: AssetObject[] = [];
    const references: AssetReference[] = [];
    let beforeLock = options.beforeLock;
    const objectMatches = (row: AssetObject, query: ReturnType<typeof dialect.sqlToQuery>) => {
        const values = query.params;
        const cutoffValue = values.find(
            (value) => value instanceof Date || (typeof value === "string" && value.endsWith("Z")),
        );
        if (query.sql.includes('"asset_objects"."unreferenced_at" <=') && cutoffValue) {
            const cutoff =
                cutoffValue instanceof Date ? cutoffValue : new Date(String(cutoffValue));
            return (
                !row.pinned &&
                row.unreferenced_at !== null &&
                row.unreferenced_at <= cutoff &&
                (!values.includes("assets") || values.includes(row.collection)) &&
                (!values.some(
                    (value) => typeof value === "string" && value.startsWith("uploads/"),
                ) ||
                    values.includes(row.asset_path))
            );
        }
        if (values.includes(false) && row.pinned) return false;
        return (
            ((!values.includes("assets") && !values.includes("userassets")) ||
                values.includes(row.collection)) &&
            (!values.some((value) => typeof value === "string" && value.startsWith("uploads/")) ||
                values.includes(row.asset_path)) &&
            (!values.some((value) => typeof value === "string" && /^[a-f0-9]{64}\./.test(value)) ||
                values.includes(row.asset_path))
        );
    };
    const referenceMatches = (
        row: AssetReference,
        query: ReturnType<typeof dialect.sqlToQuery>,
    ) => {
        const values = query.params;
        if (values.length === 1) return values[0] === row.id;
        return values.includes(row.collection) && values.includes(row.asset_path);
    };

    const transaction = {
        execute: vi.fn(async () => {
            beforeLock?.();
            beforeLock = undefined;
            return [];
        }),
        select: vi.fn(() => ({
            from(table: unknown) {
                return {
                    where(condition: unknown) {
                        const query = dialect.sqlToQuery(condition as never);
                        const rows =
                            table === assetObjects
                                ? objects.filter((row) => objectMatches(row, query))
                                : table === assetReferences
                                  ? references.filter((row) => referenceMatches(row, query))
                                  : [];
                        return {
                            orderBy() {
                                return {
                                    limit: async (limit: number) => rows.slice(0, limit),
                                };
                            },
                            limit: async (limit: number) => rows.slice(0, limit),
                        };
                    },
                };
            },
        })),
        insert: vi.fn((table: unknown) => ({
            values: async (value: AssetObject | AssetReference) => {
                if (table === assetObjects) objects.push(value as AssetObject);
                else if (table === assetReferences) references.push(value as AssetReference);
            },
        })),
        update: vi.fn((table: unknown) => ({
            set(value: Partial<AssetObject>) {
                return {
                    where: async (condition: unknown) => {
                        const query = dialect.sqlToQuery(condition as never);
                        if (table === assetObjects) {
                            for (const row of objects.filter((item) =>
                                objectMatches(item, query),
                            )) {
                                Object.assign(row, value);
                            }
                        }
                    },
                };
            },
        })),
        delete: vi.fn((table: unknown) => ({
            where: async (condition: unknown) => {
                const query = dialect.sqlToQuery(condition as never);
                if (table === assetReferences) {
                    const remaining = references.filter((row) => !referenceMatches(row, query));
                    references.splice(0, references.length, ...remaining);
                } else if (table === assetObjects) {
                    const remaining = objects.filter((row) => !objectMatches(row, query));
                    objects.splice(0, objects.length, ...remaining);
                }
            },
        })),
    };
    const database = {
        ...transaction,
        transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    } as unknown as DrizzleDatabase;
    return {
        database,
        objects,
        references,
        transaction,
        setBeforeLock(callback: () => void) {
            beforeLock = callback;
        },
    };
}

describe("managed permalink asset lifecycle", () => {
    let projectRoot: string;
    let storageRoot: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        lstatFault.path = "";
        lstatFault.code = "";
        projectRoot = await mkdtemp(join(tmpdir(), "permalink-assets-lifecycle-"));
        storageRoot = join(projectRoot, "persistent-assets");
        cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", storageRoot);
    });

    afterEach(async () => {
        lstatFault.path = "";
        lstatFault.code = "";
        cwdSpy?.mockRestore();
        vi.unstubAllEnvs();
        await rm(projectRoot, { recursive: true, force: true });
    });

    const publish = async (database: DrizzleDatabase, content: Buffer, createdBy = 9) => {
        const stagedName = await stageAssetFromStream(
            Readable.from([content]),
            1024,
            undefined,
            "assets",
        );
        return publishStagedAssetContentAddressed(stagedName, ".png", "assets", {
            database,
            createdBy,
        });
    };

    const objectPath = (relativePath: string) =>
        join(getAssetStorageRoot(), "assets", ...relativePath.split("/"));

    it("deduplicates bytes, retains each permalink, waits seven days, then collects the orphan", async () => {
        const { database, objects, references } = fakeDatabase();
        const bytes = Buffer.from("same uploaded image");
        const first = await publish(database, bytes);
        const second = await publish(database, bytes, 10);

        expect(second.relativePath).toBe(first.relativePath);
        expect(second.referenceId).not.toBe(first.referenceId);
        expect(objects).toHaveLength(1);
        expect(objects[0]?.pinned).toBe(false);
        expect(references).toHaveLength(2);

        const releasedAt = new Date("2026-01-01T00:00:00.000Z");
        await expect(
            releaseAssetReference(database, first.referenceId!, 9, false, releasedAt),
        ).resolves.toBe(true);
        expect(objects[0]?.unreferenced_at).toBeNull();
        await expect(
            releaseAssetReference(database, second.referenceId!, 10, false, releasedAt),
        ).resolves.toBe(true);
        expect(objects[0]?.unreferenced_at).toEqual(releasedAt);

        const beforeGraceExpires = await collectOrphanPermalinkAssets(database, {
            now: releasedAt.getTime() + 7 * DAY_MS - 1,
        });
        expect(beforeGraceExpires.deleted).toBe(0);
        await expect(lstat(objectPath(first.relativePath))).resolves.toBeDefined();

        const atGraceExpiry = await collectOrphanPermalinkAssets(database, {
            now: releasedAt.getTime() + 7 * DAY_MS,
        });
        expect(atGraceExpiry.deleted).toBe(1);
        expect(objects).toHaveLength(0);
        await expect(lstat(objectPath(first.relativePath))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("keeps a pre-existing unregistered object pinned after its reference is released", async () => {
        const bytes = Buffer.from("unknown existing public object");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const relativePath = `uploads/${digest}.png`;
        await createAsset(relativePath, bytes);
        const { database, objects } = fakeDatabase();
        const published = await publish(database, bytes);

        expect(published.relativePath).toBe(relativePath);
        expect(objects[0]?.pinned).toBe(true);
        await releaseAssetReference(database, published.referenceId!, 9, false, new Date(0));
        const collected = await collectOrphanPermalinkAssets(database, {
            now: 10 * DAY_MS,
        });

        expect(collected.scanned).toBe(0);
        await expect(lstat(objectPath(relativePath))).resolves.toBeDefined();
    });

    it("rejects a registry row whose hash metadata disagrees with the staged bytes", async () => {
        const bytes = Buffer.from("published bytes must match registry metadata");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const relativePath = `uploads/${digest}.png`;
        const { database, objects, references } = fakeDatabase();
        await createAsset(relativePath, bytes);
        objects.push({
            collection: "assets",
            asset_path: relativePath,
            sha256: "0".repeat(64),
            byte_size: bytes.length,
            pinned: false,
            unreferenced_at: null,
        });

        await expect(publish(database, bytes)).rejects.toThrow(
            "Registered asset metadata does not match its content hash",
        );
        expect(references).toHaveLength(0);
    });

    it("rechecks references under the lifecycle lock before removing an eligible object", async () => {
        const { database, objects, references } = fakeDatabase();
        const published = await publish(database, Buffer.from("late reference"));
        await releaseAssetReference(database, published.referenceId!, 9, false, new Date(0));
        const object = objects[0]!;
        let racer: ReturnType<typeof fakeDatabase>;
        racer = fakeDatabase({
            beforeLock: () => {
                racer.references.push({
                    id: "late-reference",
                    collection: object.collection,
                    asset_path: object.asset_path,
                    reference_type: "permalink",
                    created_by: 10,
                });
            },
        });
        // Share the same persisted rows while giving the collector a hook at lock acquisition.
        racer.objects.push(...objects);
        racer.references.push(...references);
        const result = await collectOrphanPermalinkAssets(racer.database, { now: 8 * DAY_MS });

        expect(result.referenced).toBe(1);
        expect(objects[0]?.unreferenced_at).toBeNull();
        await expect(lstat(objectPath(published.relativePath))).resolves.toBeDefined();
    });

    it("does not remove a permalink that disappears before the locked recheck", async () => {
        const { database, references, setBeforeLock } = fakeDatabase();
        const published = await publish(database, Buffer.from("reference removal race"));
        setBeforeLock(() => references.splice(0, references.length));

        await expect(releaseAssetReference(database, published.referenceId!, 9)).resolves.toBe(
            false,
        );
        expect(references).toHaveLength(0);
    });

    it("skips an orphan row removed before its locked recheck", async () => {
        const { database, objects, setBeforeLock } = fakeDatabase();
        const published = await publish(database, Buffer.from("registry removal race"));
        await releaseAssetReference(database, published.referenceId!, 9, false, new Date(0));
        setBeforeLock(() => objects.splice(0, objects.length));

        const result = await collectOrphanPermalinkAssets(database, { now: 8 * DAY_MS });

        expect(result).toMatchObject({ scanned: 1, deleted: 0, missing: 1 });
        await expect(lstat(objectPath(published.relativePath))).resolves.toBeDefined();
    });

    it("stops after the configured maximum number of orphan deletions", async () => {
        const { database, objects } = fakeDatabase();
        const first = await publish(database, Buffer.from("first eligible orphan"));
        const second = await publish(database, Buffer.from("second eligible orphan"));
        await releaseAssetReference(database, first.referenceId!, 9, false, new Date(0));
        await releaseAssetReference(database, second.referenceId!, 9, false, new Date(0));

        const result = await collectOrphanPermalinkAssets(database, {
            now: 8 * DAY_MS,
            maxDeletions: 1,
        });

        expect(result.deleted).toBe(1);
        expect(objects).toHaveLength(1);
    });

    it("propagates non-ENOENT errors while checking a collected object's file", async () => {
        const { database } = fakeDatabase();
        const published = await publish(database, Buffer.from("inaccessible orphan"));
        await releaseAssetReference(database, published.referenceId!, 9, false, new Date(0));
        const filePath = objectPath(published.relativePath);
        lstatFault.path = filePath;
        lstatFault.code = "EACCES";

        await expect(
            collectOrphanPermalinkAssets(database, { now: 8 * DAY_MS }),
        ).rejects.toMatchObject({ code: "EACCES" });
        await expect(lstat(filePath)).resolves.toBeDefined();
    });

    it("preserves unexpected directories and removes stale registry rows for missing files", async () => {
        const { database, objects } = fakeDatabase();
        const unsafe = await publish(database, Buffer.from("directory object"));
        await releaseAssetReference(database, unsafe.referenceId!, 9, false, new Date(0));
        const unsafePath = objectPath(unsafe.relativePath);
        await rm(unsafePath);
        await mkdir(unsafePath);
        const missing = await publish(database, Buffer.from("missing object"));
        await releaseAssetReference(database, missing.referenceId!, 9, false, new Date(0));
        await unlink(objectPath(missing.relativePath));

        const result = await collectOrphanPermalinkAssets(database, { now: 8 * DAY_MS });

        expect(result.unsafe).toBe(1);
        expect(result.missing).toBe(1);
        expect(objects).toHaveLength(1);
        expect((await lstat(unsafePath)).isDirectory()).toBe(true);
    });

    it("requires an owner or admin to release a reference and validates bounded GC options", async () => {
        const { database, references } = fakeDatabase();
        const published = await publish(database, Buffer.from("permission check"));

        await expect(releaseAssetReference(database, published.referenceId!, 10)).resolves.toBe(
            false,
        );
        expect(references).toHaveLength(1);
        await expect(
            releaseAssetReference(database, published.referenceId!, 10, true),
        ).resolves.toBe(true);
        await expect(collectOrphanPermalinkAssets(database, { maxScanned: 1001 })).rejects.toThrow(
            "maxScanned must be an integer",
        );
        await expect(collectOrphanPermalinkAssets(database, { maxDeletions: 101 })).rejects.toThrow(
            "maxDeletions must be an integer",
        );
        await expect(collectOrphanPermalinkAssets(database, { now: Number.NaN })).rejects.toThrow(
            "non-negative safe integer",
        );
    });
});
