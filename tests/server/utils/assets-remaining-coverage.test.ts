import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const filesystemFaults = vi.hoisted(() => ({
    linkCode: "",
    linkMutationBytes: null as Buffer | null,
    openBehaviors: new Map<string, string>(),
    lstatCodes: new Map<string, string>(),
    lstatSkipCounts: new Map<string, number>(),
    lstatSymlinkPaths: new Set<string>(),
    syncLstatSymlinkPaths: new Set<string>(),
    syncLstatCodes: new Map<string, string>(),
    opendirCodes: new Map<string, string>(),
    mkdirRacePaths: new Set<string>(),
    mkdirCodes: new Map<string, string>(),
    rmCodes: new Map<string, string>(),
    opendirOrders: new Map<string, string[][]>(),
    failLeaseStat: false,
    failLeaseClose: false,
    trackLeaseUtimes: false,
    failLeaseUtimes: false,
    leaseUtimesCalls: 0,
    leakedHandles: [] as Array<{ close: () => Promise<void> }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    const codedError = (code: string) => Object.assign(new Error(`injected ${code}`), { code });

    return {
        ...actual,
        mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
            const path = String(args[0]);
            const code = filesystemFaults.mkdirCodes.get(path);
            if (code) {
                filesystemFaults.mkdirCodes.delete(path);
                throw codedError(code);
            }
            const result = await actual.mkdir(...args);
            if (filesystemFaults.mkdirRacePaths.delete(path)) throw codedError("EEXIST");
            return result;
        },
        rm: async (...args: Parameters<typeof actual.rm>) => {
            const path = String(args[0]);
            const code = filesystemFaults.rmCodes.get(path);
            if (code) {
                filesystemFaults.rmCodes.delete(path);
                throw codedError(code);
            }
            return actual.rm(...args);
        },
        link: async (...args: Parameters<typeof actual.link>) => {
            if (filesystemFaults.linkCode === "EPERM_MARK_SOURCE_NONFILE") {
                filesystemFaults.openBehaviors.set(String(args[0]), "non-file");
                throw codedError("EPERM");
            }
            if (filesystemFaults.linkCode === "EEXIST_MARK_SOURCE_ZERO_READ") {
                filesystemFaults.openBehaviors.set(String(args[0]), "zero-read");
                throw codedError("EEXIST");
            }
            if (filesystemFaults.linkCode === "EEXIST_MARK_SOURCE_SHORT_READ") {
                filesystemFaults.openBehaviors.set(String(args[0]), "zero-read");
                throw codedError("EEXIST");
            }
            if (filesystemFaults.linkCode === "EXDEV_MARK_SOURCE_ZERO_READ") {
                filesystemFaults.openBehaviors.set(String(args[0]), "zero-read");
                throw codedError("EXDEV");
            }
            if (filesystemFaults.linkCode === "EEXIST_MUTATE_IDENTICAL") {
                const bytes = filesystemFaults.linkMutationBytes;
                if (bytes) {
                    await actual.writeFile(String(args[0]), bytes);
                    await actual.writeFile(String(args[1]), bytes);
                }
                throw codedError("EEXIST");
            }
            if (filesystemFaults.linkCode === "EXDEV_MUTATE_SOURCE") {
                const bytes = filesystemFaults.linkMutationBytes;
                if (bytes) await actual.writeFile(String(args[0]), bytes);
                throw codedError("EXDEV");
            }
            if (filesystemFaults.linkCode) throw codedError(filesystemFaults.linkCode);
            return actual.link(...args);
        },
        lstat: async (...args: Parameters<typeof actual.lstat>) => {
            const path = String(args[0]);
            if (filesystemFaults.lstatSymlinkPaths.has(path)) {
                return {
                    isSymbolicLink: () => true,
                    isDirectory: () => false,
                    isFile: () => false,
                } as Awaited<ReturnType<typeof actual.lstat>>;
            }
            const code = filesystemFaults.lstatCodes.get(path);
            if (code) {
                const skippedCalls = filesystemFaults.lstatSkipCounts.get(path) ?? 0;
                if (skippedCalls > 0) filesystemFaults.lstatSkipCounts.set(path, skippedCalls - 1);
                else {
                    filesystemFaults.lstatCodes.delete(path);
                    filesystemFaults.lstatSkipCounts.delete(path);
                    throw codedError(code);
                }
            }
            return actual.lstat(...args);
        },
        opendir: async (...args: Parameters<typeof actual.opendir>) => {
            const path = String(args[0]);
            const orders = filesystemFaults.opendirOrders.get(path);
            const names = orders?.shift();
            if (orders?.length === 0) filesystemFaults.opendirOrders.delete(path);
            if (names) {
                return {
                    async *[Symbol.asyncIterator]() {
                        for (const name of names) yield { name };
                    },
                } as Awaited<ReturnType<typeof actual.opendir>>;
            }
            const code = filesystemFaults.opendirCodes.get(path);
            if (code) {
                filesystemFaults.opendirCodes.delete(path);
                throw codedError(code);
            }
            return actual.opendir(...args);
        },
        open: async (...args: Parameters<typeof actual.open>) => {
            const path = String(args[0]);
            const behavior =
                filesystemFaults.openBehaviors.get(path) ??
                (filesystemFaults.failLeaseStat && /(?:\.lease-|\.lease$)/.test(path)
                    ? "non-file"
                    : filesystemFaults.failLeaseClose && /(?:\.lease-|\.lease$)/.test(path)
                      ? "close-error"
                      : filesystemFaults.trackLeaseUtimes && /(?:\.lease-|\.lease$)/.test(path)
                        ? "track-utimes"
                        : undefined);
            if (behavior === "open-eacces") throw codedError("EACCES");

            const handle = await actual.open(...args);
            if (!behavior) return handle;
            let statCalls = 0;
            return new Proxy(handle, {
                get(target, property) {
                    if (property === "stat" && behavior === "non-file") {
                        return async () => ({ isFile: () => false, size: 0, mtimeMs: 0 });
                    }
                    if (property === "stat" && behavior === "changed-mtime") {
                        return async () => {
                            statCalls += 1;
                            const info = await target.stat();
                            if (statCalls === 1) return info;
                            return new Proxy(info, {
                                get(stat, key) {
                                    if (key === "mtimeMs") return stat.mtimeMs + 1000;
                                    return Reflect.get(stat, key, stat);
                                },
                            });
                        };
                    }
                    if (property === "read" && behavior === "zero-read") {
                        return async (buffer: Buffer) => ({ bytesRead: 0, buffer });
                    }
                    if (property === "read" && behavior === "short-read") {
                        return async (
                            buffer: Buffer,
                            offset: number,
                            length: number,
                            position: number | null,
                        ) => target.read(buffer, offset, Math.min(1, length), position);
                    }
                    if (
                        property === "write" &&
                        (behavior === "zero-write" || behavior === "zero-write-close-error")
                    ) {
                        return async (buffer: Buffer) => ({ bytesWritten: 0, buffer });
                    }
                    if (property === "utimes" && behavior === "track-utimes") {
                        return async (...utimeArgs: Parameters<typeof handle.utimes>) => {
                            filesystemFaults.leaseUtimesCalls += 1;
                            if (filesystemFaults.failLeaseUtimes) {
                                throw new Error("injected utimes failure");
                            }
                            return target.utimes(...utimeArgs);
                        };
                    }
                    if (
                        property === "close" &&
                        (behavior === "close-error" || behavior === "zero-write-close-error")
                    ) {
                        filesystemFaults.leakedHandles.push({ close: () => target.close() });
                        return async () => {
                            throw new Error("injected close failure");
                        };
                    }
                    const value = Reflect.get(target, property, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        },
    };
});

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
            const path = String(args[0]);
            const code = filesystemFaults.syncLstatCodes.get(path);
            if (code) throw Object.assign(new Error(`injected ${code}`), { code });
            if (filesystemFaults.syncLstatSymlinkPaths.has(path)) {
                return {
                    isSymbolicLink: () => true,
                    isDirectory: () => false,
                } as ReturnType<typeof actual.lstatSync>;
            }
            return actual.lstatSync(...args);
        },
    };
});

import { oauth2Applications, users } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import {
    collectOrphanProfileAssets,
    createAsset,
    createAssetFromStream,
    createUserAssetContentAddressed,
    discardStagedAsset,
    assertAssetPathWithinRoot,
    assertUploadTemporaryName,
    getAssetStorageRoot,
    getUserAssetContentAddress,
    openStoredAsset,
    publishStagedAssetContentAddressed,
    removeAsset,
    removeUserAsset,
    stageAssetFromStream,
    withAssetLifecycleLocks,
} from "~~/server/utils/assets";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_A = "12345678-1234-4234-8234-123456789abc";
const UUID_B = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const dialect = new PgDialect();

function fakeDatabase() {
    const transaction = {
        execute: vi.fn(async () => []),
        select: vi.fn(() => ({
            from(table: unknown) {
                return {
                    where(condition: unknown) {
                        const query = dialect.sqlToQuery(condition as never);
                        if (table !== users && table !== oauth2Applications) {
                            throw new Error("Unexpected table in asset reference query");
                        }
                        return { limit: async () => [] };
                    },
                };
            },
        })),
    };
    const database = {
        transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    } as unknown as DrizzleDatabase;
    return { database, transaction };
}

describe("remaining asset utility behavior", () => {
    let projectRoot: string;
    let storageRoot: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "assets-remaining-"));
        storageRoot = join(projectRoot, "persistent-assets");
        cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", storageRoot);
        filesystemFaults.linkCode = "";
        filesystemFaults.linkMutationBytes = null;
        filesystemFaults.openBehaviors.clear();
        filesystemFaults.lstatCodes.clear();
        filesystemFaults.lstatSkipCounts.clear();
        filesystemFaults.lstatSymlinkPaths.clear();
        filesystemFaults.syncLstatSymlinkPaths.clear();
        filesystemFaults.syncLstatCodes.clear();
        filesystemFaults.opendirCodes.clear();
        filesystemFaults.opendirOrders.clear();
        filesystemFaults.mkdirRacePaths.clear();
        filesystemFaults.mkdirCodes.clear();
        filesystemFaults.rmCodes.clear();
        filesystemFaults.failLeaseStat = false;
        filesystemFaults.failLeaseClose = false;
        filesystemFaults.trackLeaseUtimes = false;
        filesystemFaults.failLeaseUtimes = false;
        filesystemFaults.leaseUtimesCalls = 0;
        filesystemFaults.leakedHandles.length = 0;
    });

    afterEach(async () => {
        await Promise.all(
            filesystemFaults.leakedHandles.map(({ close }) => close().catch(() => {})),
        );
        vi.useRealTimers();
        cwdSpy?.mockRestore();
        vi.unstubAllEnvs();
        await rm(projectRoot, { recursive: true, force: true });
    });

    const storedPath = (collection: "assets" | "userassets", name: string) =>
        join(storageRoot, collection, ...name.split("/"));

    const makeOld = async (path: string, now: number) => {
        const old = new Date(now - 8 * DAY_MS);
        await utimes(path, old, old);
    };

    it("rejects a relative storage override instead of resolving it from the release directory", () => {
        vi.stubEnv("ASSET_STORAGE_DIR", "relative/assets");
        expect(() => getAssetStorageRoot()).toThrow("must be an absolute path");
    });

    it("checks upload containment with both in-root and escaped paths", () => {
        const root = join(projectRoot, "assets");
        expect(() =>
            assertAssetPathWithinRoot(root, join(root, "uploads", "file.txt")),
        ).not.toThrow();
        expect(() => assertAssetPathWithinRoot(root, join(projectRoot, "outside.txt"))).toThrow(
            "Invalid asset path",
        );
    });

    it("checks generated and caller-supplied upload temporary names", () => {
        expect(() => assertUploadTemporaryName(undefined)).not.toThrow();
        expect(() => assertUploadTemporaryName(`.upload-${UUID_A}.tmp`)).not.toThrow();
        expect(() => assertUploadTemporaryName("../outside.tmp")).toThrow(
            "Invalid upload temporary name",
        );
    });

    it("uses the non-alias extension when publishing a staged object", async () => {
        const bytes = Buffer.from("canonical extension path");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const digest = createHash("sha256").update(bytes).digest("hex");

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".jpeg", "assets"),
        ).resolves.toEqual({ filename: `${digest}.jpg`, relativePath: `uploads/${digest}.jpg` });
    });

    it("canonicalizes a missing project subpath and safely returns when its ancestors are absent", () => {
        const missingProject = join(projectRoot, "missing", "release");
        cwdSpy.mockReturnValue(missingProject);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");

        expect(getAssetStorageRoot()).toBe(join(missingProject, "assets"));
    });

    it("rejects a non-directory at the default persistent assets path", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");
        const defaultRoot = join(projectRoot, "assets");
        await writeFile(defaultRoot, "not a directory");

        expect(() => getAssetStorageRoot()).toThrow("must contain directories only");
    });

    it("rejects a symlink at the default persistent assets path", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");
        filesystemFaults.syncLstatSymlinkPaths.add(join(projectRoot, "assets"));

        expect(() => getAssetStorageRoot()).toThrow("must not contain symbolic links");
    });

    it("propagates unexpected filesystem failures while checking the project root", () => {
        const failurePath = projectRoot;
        filesystemFaults.syncLstatCodes.set(failurePath, "EACCES");
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");

        expect(() => getAssetStorageRoot()).toThrow("injected EACCES");
    });

    it("rejects writes below an existing regular file used as a directory", async () => {
        await createAsset("not-a-directory", Buffer.from("file"));
        await expect(
            createAsset("not-a-directory/child.txt", Buffer.from("data")),
        ).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid asset path",
        });
    });

    it("rejects a storage root, collection root, or nested parent that has become a symlink", async () => {
        filesystemFaults.lstatSymlinkPaths.add(storageRoot);
        await expect(createAsset("root.txt", Buffer.from("data"))).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Asset storage is unavailable",
        });

        filesystemFaults.lstatSymlinkPaths.clear();
        const collectionPath = join(storageRoot, "assets");
        filesystemFaults.lstatSymlinkPaths.add(collectionPath);
        await expect(createAsset("collection.txt", Buffer.from("data"))).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Asset storage is unavailable",
        });

        filesystemFaults.lstatSymlinkPaths.clear();
        const nestedPath = join(collectionPath, "nested");
        filesystemFaults.lstatSymlinkPaths.add(nestedPath);
        await expect(createAsset("nested/file.txt", Buffer.from("data"))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: "Invalid asset path",
        });
    });

    it("rejects reads through a symlinked parent directory", async () => {
        const directory = join(storageRoot, "assets", "external");
        await mkdir(directory, { recursive: true });
        filesystemFaults.lstatSymlinkPaths.add(directory);

        await expect(openStoredAsset("assets", "external/file.txt")).rejects.toMatchObject({
            statusCode: 404,
            statusMessage: "Asset not found",
        });
    });

    it("creates a profile object under its normalized SHA-256 path and permits both supported aliases", async () => {
        const bytes = Buffer.from("large enough profile image bytes");
        const expected = `profiles/${createHash("sha256").update(bytes).digest("hex")}.jpg`;
        await expect(createUserAssetContentAddressed(bytes, ".jpeg")).resolves.toBe(expected);
        await expect(createUserAssetContentAddressed(bytes, ".jpg")).resolves.toBe(expected);
        await expect(lstat(storedPath("userassets", expected))).resolves.toBeDefined();
    });

    it("rejects an existing profile object whose file type or size does not match its address", async () => {
        const bytes = Buffer.from("valid image bytes");
        const relativePath = getUserAssetContentAddress(bytes, ".png");
        const destination = storedPath("userassets", relativePath);
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(destination, Buffer.from("short"));

        await expect(createUserAssetContentAddressed(bytes, ".png")).rejects.toThrow(
            "Existing content-addressed profile asset is invalid",
        );

        filesystemFaults.openBehaviors.set(destination, "non-file");
        await expect(createUserAssetContentAddressed(bytes, ".png")).rejects.toThrow(
            "Existing content-addressed profile asset is invalid",
        );
    });

    it("rejects a profile object when verification encounters an empty read", async () => {
        const bytes = Buffer.from("profile bytes with a stable address");
        const relativePath = getUserAssetContentAddress(bytes, ".webp");
        const destination = storedPath("userassets", relativePath);
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(destination, bytes);
        filesystemFaults.linkCode = "EEXIST";
        filesystemFaults.openBehaviors.set(destination, "zero-read");

        await expect(createUserAssetContentAddressed(bytes, ".webp")).rejects.toThrow(
            "does not match its digest",
        );
    });

    it("propagates non-fallback profile publication errors", async () => {
        filesystemFaults.linkCode = "EACCES";

        await expect(
            createUserAssetContentAddressed(Buffer.from("profile"), ".png"),
        ).rejects.toMatchObject({
            code: "EACCES",
        });
    });

    it("propagates non-collision errors from the exclusive profile-copy fallback", async () => {
        const bytes = Buffer.from("profile-copy-fallback-error");
        const relativePath = getUserAssetContentAddress(bytes, ".jpg");
        const destination = storedPath("userassets", relativePath);
        filesystemFaults.linkCode = "EPERM";
        filesystemFaults.openBehaviors.set(destination, "open-eacces");

        await expect(createUserAssetContentAddressed(bytes, ".jpg")).rejects.toMatchObject({
            code: "EACCES",
        });
    });

    it("rejects non-string profile extensions at the content-address boundary", () => {
        expect(() => getUserAssetContentAddress(Buffer.from("image"), null as never)).toThrow(
            "extension is invalid",
        );
    });

    it("releases upload leases when a staged asset is discarded twice", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("temporary upload")]),
            128,
            undefined,
            "assets",
        );
        await discardStagedAsset(stagedName, "assets");
        await expect(discardStagedAsset(stagedName, "assets")).resolves.toBeUndefined();
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("closes and removes a lease when its newly created file is not regular", async () => {
        filesystemFaults.failLeaseStat = true;

        await expect(
            stageAssetFromStream(Readable.from([Buffer.from("upload")]), 64, undefined, "assets"),
        ).rejects.toThrow("Unable to create upload lease");
        await expect(readdir(join(storageRoot, "assets", ".staging"))).resolves.toEqual([]);
    });

    it("runs the upload heartbeat and tolerates heartbeat failure", async () => {
        filesystemFaults.trackLeaseUtimes = true;
        filesystemFaults.failLeaseUtimes = true;
        vi.useFakeTimers();
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("heartbeat upload")]),
            64,
            undefined,
            "assets",
        );

        await vi.advanceTimersByTimeAsync(30_000);

        expect(filesystemFaults.leaseUtimesCalls).toBe(1);
        await expect(lstat(storedPath("assets", stagedName))).resolves.toBeDefined();
        await discardStagedAsset(stagedName, "assets");
    });

    it("continues staged cleanup when closing and unlinking a lease fail", async () => {
        filesystemFaults.failLeaseClose = true;
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("cleanup despite lease error")]),
            64,
            undefined,
            "assets",
        );

        await expect(discardStagedAsset(stagedName, "assets")).resolves.toBeUndefined();
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("continues cleanup when the lease unlink itself fails", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("cleanup after unlink failure")]),
            64,
            undefined,
            "assets",
        );
        const id = stagedName.slice(".staging/".length, -".tmp".length);
        filesystemFaults.rmCodes.set(storedPath("assets", `.staging/.lease-${id}.tmp`), "EACCES");

        await expect(discardStagedAsset(stagedName, "assets")).resolves.toBeUndefined();
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("does nothing when asked to discard an absent staging token and rejects published names", async () => {
        await expect(discardStagedAsset(undefined, "assets")).resolves.toBeUndefined();
        await expect(discardStagedAsset("uploads/public.txt", "assets")).rejects.toThrow(
            "Invalid staged asset token",
        );
    });

    it("rejects a staged token with a traversal component before accessing storage", async () => {
        await expect(
            publishStagedAssetContentAddressed(".staging/../secret.tmp", ".txt", "assets"),
        ).rejects.toThrow("Invalid staged asset token");
    });

    it("cleans staged objects when the content-address extension is unsupported", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("source bytes")]),
            128,
            undefined,
            "assets",
        );
        await expect(
            publishStagedAssetContentAddressed(stagedName, ".exe", "assets"),
        ).rejects.toThrow("extension is not supported");
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(readdir(join(storageRoot, "assets", ".staging"))).resolves.toEqual([]);
    });

    it("cleans staged objects when a non-string content-address extension is rejected", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("source bytes")]),
            128,
            undefined,
            "assets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, null as never, "assets"),
        ).rejects.toThrow("extension is invalid");
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("accepts an identical existing published object after checking every content chunk", async () => {
        const bytes = Buffer.alloc(150_000, 0x5a);
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.pdf`);
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, bytes);
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes.subarray(0, 32_000), bytes.subarray(32_000)]),
            bytes.length,
            undefined,
            "assets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".pdf", "assets"),
        ).resolves.toEqual({ filename: `${digest}.pdf`, relativePath: `uploads/${digest}.pdf` });
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("rejects same-size content-address collisions without changing the published bytes", async () => {
        const bytes = Buffer.from("the source content at this digest");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        const tampered = Buffer.from(bytes);
        tampered[0] ^= 1;
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, tampered);
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Content-addressed asset path collision");
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(lstat(destination)).resolves.toBeDefined();
    });

    it("rejects a content-address collision when the existing object has a different size", async () => {
        const bytes = Buffer.from("source object has a content address");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, "short");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Content-addressed asset path collision");
    });

    it.each(["EEXIST_MARK_SOURCE_ZERO_READ", "EEXIST_MARK_SOURCE_SHORT_READ"] as const)(
        "rejects a destination comparison after the source returns %s",
        async (linkCode) => {
            const bytes = Buffer.from("comparison source bytes");
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
            if (linkCode === "EEXIST_MARK_SOURCE_SHORT_READ") {
                filesystemFaults.linkCode = "EEXIST_MARK_SOURCE_ZERO_READ";
                filesystemFaults.openBehaviors.set(storedPath("assets", stagedName), "short-read");
            } else {
                filesystemFaults.linkCode = linkCode;
            }

            await expect(
                publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
            ).rejects.toThrow("Content-addressed asset path collision");
        },
    );

    it("rejects equal concurrent replacement bytes when their digest no longer matches the staged name", async () => {
        const original = Buffer.from("content before concurrent replacement");
        const digest = createHash("sha256").update(original).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        const replacement = Buffer.alloc(original.length, 0x78);
        await mkdir(join(storageRoot, "assets", "uploads"), { recursive: true });
        await writeFile(destination, original);
        const stagedName = await stageAssetFromStream(
            Readable.from([original]),
            original.length,
            undefined,
            "assets",
        );
        filesystemFaults.linkMutationBytes = replacement;
        filesystemFaults.linkCode = "EEXIST_MUTATE_IDENTICAL";

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Content-addressed asset digest mismatch");
    });

    it("publishes user collection objects directly without a public uploads prefix", async () => {
        const bytes = Buffer.from("user scoped staged content");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "userassets",
        );

        await expect(
            publishStagedAssetContentAddressed(stagedName, "txt", "userassets"),
        ).resolves.toEqual({ filename: `${digest}.txt`, relativePath: `${digest}.txt` });
        await expect(readFile(storedPath("userassets", `${digest}.txt`))).resolves.toEqual(bytes);
    });

    it.each(["non-file", "zero-read", "changed-mtime"] as const)(
        "rejects a staged source that is %s during hashing",
        async (behavior) => {
            const stagedName = await stageAssetFromStream(
                Readable.from([Buffer.from("hash source integrity")]),
                128,
                undefined,
                "assets",
            );
            filesystemFaults.openBehaviors.set(storedPath("assets", stagedName), behavior);

            await expect(
                publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
            ).rejects.toThrow(
                behavior === "non-file"
                    ? "Asset object is not a regular file"
                    : "Asset object changed while it was being hashed",
            );
            await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
                code: "ENOENT",
            });
        },
    );

    it("propagates non-collision errors from staged object publication", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("link error")]),
            128,
            undefined,
            "assets",
        );
        filesystemFaults.linkCode = "EACCES";

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toMatchObject({ code: "EACCES" });
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("removes a partial fallback copy when the destination reports zero-byte writes", async () => {
        const bytes = Buffer.from("copy destination cannot make progress");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        filesystemFaults.linkCode = "EPERM";
        filesystemFaults.openBehaviors.set(destination, "zero-write-close-error");

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Unable to copy stored asset");
        await expect(lstat(storedPath("assets", stagedName))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("fails closed when the source object changes before an exclusive fallback copy", async () => {
        const bytes = Buffer.from("fallback source type check");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const digest = createHash("sha256").update(bytes).digest("hex");
        filesystemFaults.linkCode = "EPERM_MARK_SOURCE_NONFILE";

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Asset source is not a regular file");
        await expect(lstat(storedPath("assets", `uploads/${digest}.txt`))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("propagates a non-collision error from staged copy fallback", async () => {
        const bytes = Buffer.from("fallback destination open fails");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const digest = createHash("sha256").update(bytes).digest("hex");
        const destination = storedPath("assets", `uploads/${digest}.txt`);
        filesystemFaults.linkCode = "EXDEV";
        filesystemFaults.openBehaviors.set(destination, "open-eacces");

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toMatchObject({ code: "EACCES" });
    });

    it("rejects a truncated staged copy after a zero-length read", async () => {
        const bytes = Buffer.from("source becomes unreadable during fallback");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        filesystemFaults.linkCode = "EXDEV_MARK_SOURCE_ZERO_READ";

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Staged asset changed before publication");
    });

    it("rejects a staged copy whose bytes change after hashing", async () => {
        const bytes = Buffer.from("source content before fallback");
        const mutated = Buffer.from("source content during fallback");
        expect(mutated.length).toBe(bytes.length);
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        filesystemFaults.linkCode = "EXDEV_MUTATE_SOURCE";
        filesystemFaults.linkMutationBytes = mutated;

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Staged asset changed before publication");
    });

    it("preserves the original copy error when destination cleanup also fails", async () => {
        const bytes = Buffer.from("cleanup failure after truncated copy");
        const stagedName = await stageAssetFromStream(
            Readable.from([bytes]),
            bytes.length,
            undefined,
            "assets",
        );
        const digest = createHash("sha256").update(bytes).digest("hex");
        filesystemFaults.linkCode = "EXDEV_MARK_SOURCE_ZERO_READ";
        filesystemFaults.rmCodes.set(storedPath("assets", `uploads/${digest}.txt`), "EACCES");

        await expect(
            publishStagedAssetContentAddressed(stagedName, ".txt", "assets"),
        ).rejects.toThrow("Staged asset changed before publication");
        await rm(storedPath("assets", `uploads/${digest}.txt`), { force: true });
    });

    it("rejects a streamed upload whose parent component is a regular file", async () => {
        await createAsset("blocked", Buffer.from("file"));
        await expect(
            createAssetFromStream("blocked/upload.txt", Readable.from(["data"]), 64),
        ).rejects.toBeDefined();
    });

    it("accepts a directory created concurrently while preparing a streamed upload", async () => {
        const racedDirectory = storedPath("assets", "raced");
        filesystemFaults.mkdirRacePaths.add(racedDirectory);

        await expect(
            createAssetFromStream("raced/upload.txt", Readable.from(["bytes"]), 64),
        ).resolves.toBe("upload.txt");
    });

    it("propagates a directory preparation failure other than EEXIST", async () => {
        const blockedDirectory = storedPath("assets", "blocked");
        filesystemFaults.mkdirCodes.set(blockedDirectory, "EACCES");

        await expect(
            createAssetFromStream("blocked/upload.txt", Readable.from(["bytes"]), 64),
        ).rejects.toMatchObject({ code: "EACCES" });
    });

    it("rejects removal of content-addressed objects through either collection", async () => {
        const bytes = Buffer.from("immutable bytes");
        const digest = createHash("sha256").update(bytes).digest("hex");
        await expect(removeAsset(`uploads/${digest}.txt`)).rejects.toMatchObject({
            statusCode: 409,
        });
        await expect(removeUserAsset(`${digest}.txt`)).rejects.toMatchObject({ statusCode: 409 });
        await expect(removeUserAsset(`profiles/${digest}.jpg`)).rejects.toMatchObject({
            statusCode: 409,
        });
        await expect(removeAsset(undefined)).resolves.toBeUndefined();
        await expect(removeUserAsset(null)).resolves.toBeUndefined();
    });

    it("reports empty scans when the storage collections do not exist", async () => {
        const { database } = fakeDatabase();
        const result = await collectOrphanProfileAssets(database, { now: Date.now() });
        expect(result).toMatchObject({
            entriesVisited: 0,
            scanned: 0,
            deleted: 0,
            referenced: 0,
            tooRecent: 0,
            staleTemporaryFilesDeleted: 0,
        });
    });

    it("handles staging and profile directories removed between validation and opening", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(staging, { recursive: true });
        await mkdir(profiles, { recursive: true });
        filesystemFaults.opendirCodes.set(staging, "ENOENT");
        filesystemFaults.opendirCodes.set(profiles, "ENOENT");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).resolves.toMatchObject({
            entriesVisited: 0,
            deleted: 0,
        });
    });

    it("propagates unexpected errors while opening managed asset directories", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        filesystemFaults.opendirCodes.set(staging, "EACCES");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "EACCES",
        });
    });

    it("clears a stale staging scan cursor when the entry it pointed to was removed", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const entries = Array.from({ length: 20 }, (_, index) => `unmanaged-${index}.tmp`);
        await Promise.all(entries.map((name) => writeFile(join(staging, name), "retain")));
        filesystemFaults.opendirOrders.set(staging, [entries.slice(0, 8)]);
        const { database } = fakeDatabase();
        const first = await collectOrphanProfileAssets(database, { maxScanned: 8 });
        await rm(join(staging, entries[7]!));

        const second = await collectOrphanProfileAssets(database, { maxScanned: 8 });

        expect(first.entriesVisited).toBe(8);
        expect(second.entriesVisited).toBe(8);
    });

    it("clears a profile cursor after deleting the object it referenced", async () => {
        const { database } = fakeDatabase();
        const bytesA = Buffer.from("profile cursor removal A");
        const pathA = await createUserAssetContentAddressed(bytesA, ".png");
        const now = Date.now();
        await makeOld(storedPath("userassets", pathA), now);

        const first = await collectOrphanProfileAssets(database, { now, maxScanned: 1 });
        const bytesB = Buffer.from("profile cursor removal B");
        const pathB = await createUserAssetContentAddressed(bytesB, ".png");
        await makeOld(storedPath("userassets", pathB), now);
        const second = await collectOrphanProfileAssets(database, { now, maxScanned: 1 });

        expect(first.deleted).toBe(1);
        expect(second.deleted).toBe(1);
    });

    it("clears a staging cursor after deleting the object it referenced", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_A}.tmp`);
        await writeFile(stagePath, "old upload");
        const now = Date.now();
        await makeOld(stagePath, now);
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, {
            now,
            maxScanned: 4,
        });

        expect(result.staleTemporaryFilesDeleted).toBe(1);
        await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("cleans a profile temporary and clears its cursor", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const tempPath = join(profiles, `.profile-${UUID_A}.tmp`);
        await writeFile(tempPath, "old profile temporary");
        const now = Date.now();
        await makeOld(tempPath, now);
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });

        expect(result.staleTemporaryFilesDeleted).toBe(1);
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("wraps a staged scan to earlier eligible entries when its cursor reaches the end", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const eligible = Array.from({ length: 13 }, (_, index) => {
            const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
            return `${id}.tmp`;
        });
        const marker = "cursor-marker.tmp";
        await Promise.all(
            [...eligible, marker].map((name) => writeFile(join(staging, name), "recent")),
        );
        filesystemFaults.opendirOrders.set(staging, [
            [...eligible.slice(0, 12), marker],
            [marker, "unmanaged-after-cursor.tmp"],
            [...eligible, marker],
        ]);
        const { database } = fakeDatabase();

        const first = await collectOrphanProfileAssets(database, { maxScanned: 100 });
        const second = await collectOrphanProfileAssets(database, { maxScanned: 100 });

        expect(first.entriesVisited).toBe(13);
        expect(second.entriesVisited).toBe(15);
        expect(filesystemFaults.opendirOrders.has(staging)).toBe(false);
    });

    it("retains the prior cursor when the directory empties during the wrap scan", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const marker = "cursor-marker.tmp";
        filesystemFaults.opendirOrders.set(staging, [[marker], [marker], []]);
        const { database } = fakeDatabase();

        await collectOrphanProfileAssets(database, { maxScanned: 100 });
        const result = await collectOrphanProfileAssets(database, { maxScanned: 100 });

        expect(result.entriesVisited).toBe(1);
    });

    it("skips a recently changed profile object without deleting it", async () => {
        const { database } = fakeDatabase();
        const relativePath = await createUserAssetContentAddressed(
            Buffer.from("recent profile"),
            ".jpg",
        );

        const result = await collectOrphanProfileAssets(database, { now: Date.now() });

        expect(result.tooRecent).toBe(1);
        await expect(lstat(storedPath("userassets", relativePath))).resolves.toBeDefined();
    });

    it("keeps an ordinary staged file when it disappears during metadata inspection", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_A}.tmp`);
        await writeFile(stagePath, "temporary stage");
        const { database } = fakeDatabase();
        filesystemFaults.lstatCodes.set(stagePath, "ENOENT");

        await expect(collectOrphanProfileAssets(database)).resolves.toMatchObject({
            staleTemporaryFilesDeleted: 0,
        });
        await expect(lstat(stagePath)).resolves.toBeDefined();
    });

    it("removes an upload lease when its stage file is already gone", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const leasePath = join(staging, `.lease-${UUID_A}.tmp`);
        await writeFile(leasePath, "old lease");
        await makeOld(leasePath, Date.now());
        filesystemFaults.lstatSkipCounts.set(leasePath, 1);
        filesystemFaults.lstatCodes.set(leasePath, "ENOENT");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).resolves.toMatchObject({
            staleTemporaryFilesDeleted: 0,
        });
        await expect(lstat(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("removes a profile lease when its temporary file is already gone", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const leasePath = join(profiles, `.profile-${UUID_A}.lease`);
        const tempPath = join(profiles, `.profile-${UUID_A}.tmp`);
        await writeFile(leasePath, "old lease");
        await makeOld(leasePath, Date.now());
        filesystemFaults.lstatCodes.set(tempPath, "ENOENT");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).resolves.toMatchObject({
            staleTemporaryFilesDeleted: 0,
        });
        await expect(lstat(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps an ordinary profile temporary when it disappears during metadata inspection", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const tempPath = join(profiles, `.profile-${UUID_A}.tmp`);
        await writeFile(tempPath, "temporary profile");
        filesystemFaults.lstatCodes.set(tempPath, "ENOENT");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).resolves.toMatchObject({
            staleTemporaryFilesDeleted: 0,
        });
        await expect(lstat(tempPath)).resolves.toBeDefined();
    });

    it("does not clear a cursor for a missing profile that was not the cursor entry", async () => {
        const { database } = fakeDatabase();
        const firstPath = await createUserAssetContentAddressed(
            Buffer.from("first missing"),
            ".png",
        );
        const lastPath = await createUserAssetContentAddressed(Buffer.from("last cursor"), ".png");
        const firstFile = storedPath("userassets", firstPath);
        const lastFile = storedPath("userassets", lastPath);
        const now = Date.now();
        await Promise.all([makeOld(firstFile, now), makeOld(lastFile, now)]);
        const profiles = join(storageRoot, "userassets", "profiles");
        filesystemFaults.opendirOrders.set(profiles, [
            [firstPath.slice("profiles/".length), lastPath.slice("profiles/".length)],
        ]);
        filesystemFaults.lstatCodes.set(firstFile, "ENOENT");

        const result = await collectOrphanProfileAssets(database, { now });

        expect(result).toMatchObject({ scanned: 2, deleted: 1 });
        await expect(lstat(lastFile)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("stops the cursor wrap when it exhausts its remaining entry budget", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const prefix = Array.from({ length: 40 }, (_, index) => `prefix-${index}.tmp`);
        const cursor = "cursor-marker.tmp";
        const suffix = Array.from({ length: 20 }, (_, index) => `suffix-${index}.tmp`);
        filesystemFaults.opendirOrders.set(staging, [
            [...prefix, cursor],
            [...prefix, cursor, ...suffix],
            [...prefix, cursor],
        ]);
        const { database } = fakeDatabase();

        await collectOrphanProfileAssets(database, { maxScanned: 100 });
        const second = await collectOrphanProfileAssets(database, { maxScanned: 100 });

        expect(second.entriesVisited).toBe(100);
        expect(filesystemFaults.opendirOrders.has(staging)).toBe(false);
    });

    it("stops a directory window when the eligible-name quota is full", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        await Promise.all(
            Array.from({ length: 20 }, (_, index) => {
                const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
                return writeFile(join(staging, `${id}.tmp`), "keep recent");
            }),
        );
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { maxScanned: 100 });

        expect(result.entriesVisited).toBe(13);
    });

    it("stops scanning an ineligible directory window at its entry budget", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
                writeFile(join(staging, `unmanaged-${index}.tmp`), "keep"),
            ),
        );
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { maxScanned: 4 });

        expect(result.entriesVisited).toBe(4);
    });

    it("returns safely when an asset disappears during its locked reference check", async () => {
        const { database } = fakeDatabase();
        const bytes = Buffer.from("profile removed during collection");
        const assetPath = await createUserAssetContentAddressed(bytes, ".png");
        const filePath = storedPath("userassets", assetPath);
        const now = Date.now();
        await makeOld(filePath, now);
        filesystemFaults.lstatCodes.set(filePath, "ENOENT");

        await expect(collectOrphanProfileAssets(database, { now })).resolves.toMatchObject({
            scanned: 1,
            deleted: 0,
            referenced: 0,
            tooRecent: 0,
        });

        filesystemFaults.lstatCodes.set(filePath, "EACCES");
        await expect(collectOrphanProfileAssets(database, { now })).rejects.toMatchObject({
            code: "EACCES",
        });
    });

    it("preserves temporary files and propagates unexpected lease or file metadata errors", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_A}.tmp`);
        const leasePath = join(staging, `.lease-${UUID_A}.tmp`);
        await writeFile(stagePath, "old upload");
        await makeOld(stagePath, Date.now());
        const { database } = fakeDatabase();

        filesystemFaults.lstatCodes.set(leasePath, "EACCES");
        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "EACCES",
        });

        await expect(lstat(stagePath)).resolves.toBeDefined();
    });

    it("propagates unexpected metadata failures for a staged file", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_B}.tmp`);
        await writeFile(stagePath, "old upload");
        await makeOld(stagePath, Date.now());
        filesystemFaults.lstatCodes.set(stagePath, "EACCES");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "EACCES",
        });
        await expect(lstat(stagePath)).resolves.toBeDefined();
    });

    it("removes an orphan lease left after its staged file disappears", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const leasePath = join(staging, `.lease-${UUID_A}.tmp`);
        await writeFile(leasePath, "old lease");
        await makeOld(leasePath, Date.now());
        filesystemFaults.lstatSkipCounts.set(leasePath, 1);
        filesystemFaults.lstatCodes.set(leasePath, "ENOENT");
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database);

        expect(result.staleTemporaryFilesDeleted).toBe(0);
        await expect(lstat(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("propagates unexpected metadata errors for a profile temporary", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const tempPath = join(profiles, `.profile-${UUID_A}.tmp`);
        await writeFile(tempPath, "old profile temporary");
        await makeOld(tempPath, Date.now());
        filesystemFaults.lstatCodes.set(tempPath, "EACCES");
        const { database } = fakeDatabase();

        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "EACCES",
        });
    });

    it("stops after reaching the profile object deletion budget", async () => {
        const { database } = fakeDatabase();
        const assets = await Promise.all(
            ["budget A", "budget B"].map((content) =>
                createUserAssetContentAddressed(Buffer.from(content), ".png"),
            ),
        );
        const now = Date.now();
        await Promise.all(assets.map((path) => makeOld(storedPath("userassets", path), now)));

        const result = await collectOrphanProfileAssets(database, {
            now,
            maxScanned: 100,
            maxDeletions: 1,
        });

        expect(result.deleted).toBe(1);
        expect(result.scanned).toBe(1);
    });

    it("deletes old orphaned staging files and counts leases separately", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_A}.tmp`);
        const uploadPath = join(staging, `.upload-${UUID_B}.tmp`);
        const leasePath = join(staging, `.lease-${UUID_A}.tmp`);
        await writeFile(stagePath, "staged");
        await writeFile(uploadPath, "partial");
        await writeFile(leasePath, "lease");
        const now = Date.now();
        await Promise.all([
            makeOld(stagePath, now),
            makeOld(uploadPath, now),
            makeOld(leasePath, now),
        ]);
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });

        expect(result.staleTemporaryFilesDeleted).toBe(2);
        await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(uploadPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps staged uploads protected by a non-file lease", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const stagePath = join(staging, `${UUID_A}.tmp`);
        await writeFile(stagePath, "keep while lease is malformed");
        await mkdir(join(staging, `.lease-${UUID_A}.tmp`));
        await makeOld(stagePath, Date.now());
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now: Date.now() + 8 * DAY_MS });

        expect(result.staleTemporaryFilesDeleted).toBe(0);
        await expect(lstat(stagePath)).resolves.toBeDefined();
    });

    it("removes stale profile leases even when their matching temporary file is already absent", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const leasePath = join(profiles, `.profile-${UUID_A}.lease`);
        await writeFile(leasePath, "lease");
        await makeOld(leasePath, Date.now());
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now: Date.now() + 8 * DAY_MS });

        expect(result.staleTemporaryFilesDeleted).toBe(0);
        await expect(lstat(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("stops temporary collection at the configured deletion budget", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(staging, { recursive: true });
        const paths = [UUID_A, UUID_B].map((id) => join(staging, `${id}.tmp`));
        await Promise.all(paths.map((path) => writeFile(path, "old")));
        const now = Date.now();
        await Promise.all(paths.map((path) => makeOld(path, now)));
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, {
            now,
            maxDeletions: 1,
        });

        expect(result.staleTemporaryFilesDeleted).toBe(1);
        expect(
            (
                await Promise.all(
                    paths.map(async (path) =>
                        lstat(path).then(
                            () => true,
                            () => false,
                        ),
                    ),
                )
            ).filter(Boolean),
        ).toHaveLength(1);
    });

    it("honors the deletion budget across profile temporary and object candidates", async () => {
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(profiles, { recursive: true });
        const tempPath = join(profiles, `.profile-${UUID_A}.tmp`);
        const bytes = Buffer.from("old profile orphan");
        const assetPath = `profiles/${createHash("sha256").update(bytes).digest("hex")}.png`;
        await writeFile(tempPath, "temp");
        const assetFile = storedPath("userassets", assetPath);
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(assetFile, bytes);
        const now = Date.now();
        await Promise.all([makeOld(tempPath, now), makeOld(assetFile, now)]);
        filesystemFaults.opendirOrders.set(profiles, [
            [`.profile-${UUID_A}.tmp`, assetPath.slice("profiles/".length)],
        ]);
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now, maxDeletions: 1 });

        expect(result.staleTemporaryFilesDeleted).toBe(1);
        expect(result.deleted).toBe(0);
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(assetFile)).resolves.toBeDefined();
    });

    it("fails closed when a staging directory is not a directory", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        await mkdir(join(storageRoot, "assets"), { recursive: true });
        await writeFile(staging, "not a directory");
        const { database } = fakeDatabase();
        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "ENOTDIR",
        });
    });

    it("fails closed when a profile directory is not a directory", async () => {
        const staging = join(storageRoot, "assets", ".staging");
        const profiles = join(storageRoot, "userassets", "profiles");
        await mkdir(staging, { recursive: true });
        await mkdir(join(storageRoot, "userassets"), { recursive: true });
        await writeFile(profiles, "not a directory");
        const { database } = fakeDatabase();
        await expect(collectOrphanProfileAssets(database)).rejects.toMatchObject({
            code: "ENOTDIR",
        });
    });

    it("wraps a profile scan to reach new objects added before the saved cursor", async () => {
        const { database } = fakeDatabase();
        const bytesA = Buffer.from("first cursor rotation object");
        const pathA = await createUserAssetContentAddressed(bytesA, ".png");
        const profiles = join(storageRoot, "userassets", "profiles");
        const cursorMarker = join(profiles, "z-unmanaged-marker");
        await writeFile(cursorMarker, "retained");
        const now = Date.now();
        await makeOld(storedPath("userassets", pathA), now);

        const first = await collectOrphanProfileAssets(database, { now, maxScanned: 8 });

        expect(first.deleted).toBe(1);
        const bytesB = Buffer.from("second cursor rotation object");
        const pathB = await createUserAssetContentAddressed(bytesB, ".png");
        await makeOld(storedPath("userassets", pathB), now);

        const second = await collectOrphanProfileAssets(database, { now, maxScanned: 8 });

        expect(second.deleted).toBe(1);
        await expect(lstat(storedPath("userassets", pathB))).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(lstat(cursorMarker)).resolves.toBeDefined();
    });

    it("orders advisory locks by unique sanitized asset path before invoking the callback", async () => {
        const calls: string[] = [];
        const transaction = {
            execute: vi.fn(async (query: unknown) => {
                calls.push(dialect.sqlToQuery(query as never).sql);
                return [];
            }),
        };
        const database = {
            transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
                callback(transaction),
            ),
        } as unknown as DrizzleDatabase;
        const result = await withAssetLifecycleLocks(
            database,
            ["profiles/z.png", "profiles/a.png", "profiles/a.png"],
            async () => {
                calls.push("callback");
                return "done";
            },
        );
        expect(result).toBe("done");
        expect(calls).toHaveLength(3);
        expect(calls[2]).toBe("callback");
    });
});
