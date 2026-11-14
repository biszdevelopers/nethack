import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    symlink,
    utimes,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauth2Applications, users } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import {
    collectOrphanProfileAssets,
    createAsset,
    createUserAsset,
    createUserAssetContentAddressed,
    discardStagedAsset,
    getAssetStorageRoot,
    getUserAssetContentAddress,
    openStoredAsset,
    removeAsset,
    removeUserAsset,
    stageAssetFromStream,
    withAssetLifecycleLocks,
} from "~~/server/utils/assets";

const DAY_MS = 24 * 60 * 60 * 1000;
const dialect = new PgDialect();

function fakeDatabase(
    references: {
        profilePicture?: string;
        profileTheme?: string;
        oauthPicture?: string;
        lockFailure?: Error;
        userQueryFailure?: Error;
        oauthQueryFailure?: Error;
    } = {},
) {
    const lockQueries: unknown[] = [];
    const tableQueries: unknown[] = [];
    const transaction = {
        execute: vi.fn(async (query: unknown) => {
            lockQueries.push(query);
            if (references.lockFailure) throw references.lockFailure;
            return [];
        }),
        select: vi.fn(() => ({
            from(table: unknown) {
                return {
                    where(condition: unknown) {
                        tableQueries.push({ table, condition });
                        const query = dialect.sqlToQuery(condition as never);
                        if (table === users) {
                            if (references.userQueryFailure) throw references.userQueryFailure;
                            const hasPictureReference = query.params.includes(
                                references.profilePicture,
                            );
                            const hasThemeReference = query.params.includes(
                                references.profileTheme,
                            );
                            return {
                                limit: async () =>
                                    hasPictureReference || hasThemeReference ? [{ id: 1 }] : [],
                            };
                        }
                        if (table === oauth2Applications) {
                            if (references.oauthQueryFailure) throw references.oauthQueryFailure;
                            return {
                                limit: async () =>
                                    query.params.includes(references.oauthPicture)
                                        ? [{ client_id: "test-client" }]
                                        : [],
                            };
                        }
                        throw new Error("Unexpected table in profile asset GC query");
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
    return { database, transaction, lockQueries, tableQueries };
}

describe("content-addressed profile asset lifecycle", () => {
    let projectRoot: string;
    let storageRoot: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "profile-assets-lifecycle-"));
        storageRoot = join(projectRoot, "persistent-assets");
        cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ASSET_STORAGE_DIR", storageRoot);
    });

    afterEach(async () => {
        cwdSpy?.mockRestore();
        vi.unstubAllEnvs();
        await rm(projectRoot, { recursive: true, force: true });
    });

    const getStoredPath = (collection: "assets" | "userassets", name: string) =>
        join(storageRoot, collection, ...name.split("/"));

    const makeProfileAsset = async (content: Buffer, extension = ".png") => {
        const relativePath = await createUserAssetContentAddressed(content, extension);
        return { relativePath, filePath: getStoredPath("userassets", relativePath) };
    };

    it("stores under project assets by default and ignores deployment overrides", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", join(tmpdir(), "must-not-be-used"));
        expect(getAssetStorageRoot()).toBe(join(projectRoot, "assets"));
    });

    it("rejects a symlink at the project assets root", async ({ skip }) => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");
        const target = join(projectRoot, "target");
        await mkdir(target);
        try {
            await symlink(target, join(projectRoot, "assets"), "junction");
        } catch (error) {
            if (
                ["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")
            ) {
                skip("This Windows environment does not permit creating symlinks");
            }
            throw error;
        }
        expect(() => getAssetStorageRoot()).toThrow("symbolic links");
    });

    it("checks the storage root itself before creating a file", async ({ skip }) => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ASSET_STORAGE_DIR", "");
        const target = join(projectRoot, "target");
        await mkdir(target);
        try {
            await symlink(target, join(projectRoot, "assets"), "junction");
        } catch (error) {
            if (
                ["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")
            ) {
                skip("This Windows environment does not permit creating symlinks");
            }
            throw error;
        }

        await expect(
            createAsset("uploads/should-not-write.txt", Buffer.from("data")),
        ).rejects.toThrow("symbolic links");
        await expect(readdir(target)).resolves.toEqual([]);
    });

    it("blocks hidden staging segments at the storage read boundary", async () => {
        const hiddenPath = join(storageRoot, "userassets", ".staging", "upload.tmp");
        await mkdir(join(storageRoot, "userassets", ".staging"), { recursive: true });
        await writeFile(hiddenPath, "private staging bytes");

        await expect(openStoredAsset("userassets", ".staging/upload.tmp")).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("addresses exact bytes with SHA-256 and normalizes JPEG extensions", () => {
        const content = Buffer.from("exact image bytes");
        const digest = createHash("sha256").update(content).digest("hex");
        expect(getUserAssetContentAddress(content, ".jpeg")).toBe(`profiles/${digest}.jpg`);
        expect(getUserAssetContentAddress(content, "JPG")).toBe(`profiles/${digest}.jpg`);
        expect(getUserAssetContentAddress(content, ".webp")).toBe(`profiles/${digest}.webp`);
    });

    it.each(["svg", ".svg", "..jpg", "", "pdf"])(
        "rejects unsupported profile image extension %s",
        (extension) => {
            expect(() => getUserAssetContentAddress(Buffer.from("image"), extension)).toThrow(
                "extension is not supported",
            );
        },
    );

    it("rejects empty and non-buffer content addresses", () => {
        expect(() => getUserAssetContentAddress(Buffer.alloc(0), ".png")).toThrow(
            "non-empty Buffer",
        );
        expect(() => getUserAssetContentAddress("bytes" as never, ".png")).toThrow(
            "non-empty Buffer",
        );
    });

    it("deduplicates concurrent identical content without replacing the stored object", async () => {
        const content = Buffer.from("same profile image bytes");
        const paths = await Promise.all([
            createUserAssetContentAddressed(content, ".jpeg"),
            createUserAssetContentAddressed(content, ".jpg"),
        ]);
        expect(paths).toEqual([paths[0], paths[0]]);
        await expect(readFile(getStoredPath("userassets", paths[0]))).resolves.toEqual(content);
        await expect(
            (await import("node:fs/promises")).readdir(join(storageRoot, "userassets", "profiles")),
        ).resolves.toEqual([paths[0].slice("profiles/".length)]);
    });

    it("rejects an existing content-addressed path with different bytes without overwriting it", async () => {
        const original = Buffer.from("original profile bytes");
        const { filePath } = await makeProfileAsset(original);
        const corrupted = Buffer.from("tampered profile bytes");
        expect(corrupted.length).toBe(original.length);
        await writeFile(filePath, corrupted);

        await expect(createUserAssetContentAddressed(original, ".png")).rejects.toThrow(
            "does not match its digest",
        );
        await expect(readFile(filePath)).resolves.toEqual(corrupted);
    });

    it("does not follow or replace a symlink at a content-addressed object path", async ({
        skip,
    }) => {
        const content = Buffer.from("profile bytes");
        const relativePath = getUserAssetContentAddress(content, ".png");
        const filePath = getStoredPath("userassets", relativePath);
        const outside = join(projectRoot, "outside.png");
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(outside, "outside bytes");
        try {
            await symlink(outside, filePath, "file");
        } catch (error) {
            if (
                ["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")
            ) {
                skip("This Windows environment does not permit creating symlinks");
            }
            throw error;
        }

        await expect(createUserAssetContentAddressed(content, ".png")).rejects.toBeDefined();
        await expect(readFile(outside, "utf8")).resolves.toBe("outside bytes");
        expect((await lstat(filePath)).isSymbolicLink()).toBe(true);
    });

    it("acquires sorted, deduplicated advisory locks inside one transaction", async () => {
        const { database, transaction, lockQueries } = fakeDatabase();
        const callback = vi.fn(async (tx: unknown) => tx);
        const returned = await withAssetLifecycleLocks(
            database,
            ["profiles/z.png", "profiles/a.png", "profiles/z.png"],
            callback,
        );

        expect(returned).toBe(transaction);
        expect(database.transaction).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(transaction);
        expect(lockQueries).toHaveLength(2);
        const params = lockQueries.map((query) => dialect.sqlToQuery(query as never).params);
        const getLockParams = (path: string) => {
            const hash = createHash("sha256").update(`basishacks:asset:${path}`).digest();
            return [hash.readInt32BE(0), hash.readInt32BE(4)];
        };
        expect(params).toEqual([getLockParams("profiles/a.png"), getLockParams("profiles/z.png")]);
    });

    it("propagates a lifecycle callback failure so the transaction can roll back", async () => {
        const { database } = fakeDatabase();
        const failure = new Error("reference update failed");
        await expect(
            withAssetLifecycleLocks(database, ["profiles/a.png"], async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
    });

    it("preserves profile objects referenced by user pictures", async () => {
        const { relativePath, filePath } = await makeProfileAsset(Buffer.from("picture"));
        const { database, tableQueries } = fakeDatabase({ profilePicture: relativePath });
        const now = Date.now();
        await utimes(filePath, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.referenced).toBe(1);
        await expect(lstat(filePath)).resolves.toBeDefined();
        expect(tableQueries.some(({ table }) => table === users)).toBe(true);
    });

    it("preserves profile objects referenced by user themes", async () => {
        const { relativePath, filePath } = await makeProfileAsset(Buffer.from("theme"));
        const { database } = fakeDatabase({ profileTheme: `url|${relativePath}` });
        const now = Date.now();
        await utimes(filePath, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.referenced).toBe(1);
        await expect(lstat(filePath)).resolves.toBeDefined();
    });

    it("preserves profile objects referenced by OAuth application pictures", async () => {
        const { relativePath, filePath } = await makeProfileAsset(Buffer.from("oauth image"));
        const { database, tableQueries } = fakeDatabase({ oauthPicture: relativePath });
        const now = Date.now();
        await utimes(filePath, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.referenced).toBe(1);
        await expect(lstat(filePath)).resolves.toBeDefined();
        expect(tableQueries.some(({ table }) => table === oauth2Applications)).toBe(true);
    });

    it.each(["lock", "user reference", "OAuth reference"] as const)(
        "keeps the profile file when the %s check fails",
        async (failurePoint) => {
            const { filePath } = await makeProfileAsset(
                Buffer.from(`failed ${failurePoint} check`),
            );
            const failure = new Error(`${failurePoint} query failed`);
            const { database } = fakeDatabase({
                ...(failurePoint === "lock" ? { lockFailure: failure } : {}),
                ...(failurePoint === "user reference" ? { userQueryFailure: failure } : {}),
                ...(failurePoint === "OAuth reference" ? { oauthQueryFailure: failure } : {}),
            });
            const now = Date.now();
            const old = new Date(now - 8 * DAY_MS);
            await utimes(filePath, old, old);

            await expect(collectOrphanProfileAssets(database, { now })).rejects.toBe(failure);
            await expect(lstat(filePath)).resolves.toBeDefined();
        },
    );

    it("does not remove a profile object that has become a symlink", async ({ skip }) => {
        const content = Buffer.from("profile asset symlink target");
        const assetPath = getUserAssetContentAddress(content, ".png");
        const filePath = getStoredPath("userassets", assetPath);
        const externalPath = join(projectRoot, "external.png");
        await mkdir(join(storageRoot, "userassets", "profiles"), { recursive: true });
        await writeFile(externalPath, content);
        try {
            await symlink(externalPath, filePath, "file");
        } catch (error) {
            if (
                ["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")
            ) {
                skip("This Windows environment does not permit creating symlinks");
            }
            throw error;
        }
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database);

        expect(result.deleted).toBe(0);
        await expect(readFile(externalPath)).resolves.toEqual(content);
        expect((await lstat(filePath)).isSymbolicLink()).toBe(true);
    });

    it("deletes an unreferenced object only after seven days", async () => {
        const { filePath } = await makeProfileAsset(Buffer.from("orphan image"));
        const { database } = fakeDatabase();
        const now = Date.now();
        await utimes(filePath, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.deleted).toBe(1);
        await expect(lstat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps a recent unreferenced object and reports it", async () => {
        const { filePath } = await makeProfileAsset(Buffer.from("recent image"));
        const { database } = fakeDatabase();
        const now = Date.now();

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.tooRecent).toBe(1);
        await expect(lstat(filePath)).resolves.toBeDefined();
    });

    it("uses the exact seven-day cutoff for profiles and staged uploads", async () => {
        const now = Date.now();
        const cutoff = now - 7 * DAY_MS;
        const exactProfile = await makeProfileAsset(Buffer.from("exact seven day profile"));
        const recentProfile = await makeProfileAsset(Buffer.from("one millisecond recent profile"));
        const stagingDirectory = join(storageRoot, "assets", ".staging");
        await mkdir(stagingDirectory, { recursive: true });
        const exactStage = join(stagingDirectory, "12345678-1234-4234-8234-123456789abc.tmp");
        const recentStage = join(stagingDirectory, "abcdefab-cdef-4abc-8def-abcdefabcdef.tmp");
        await writeFile(exactStage, "exact seven day stage");
        await writeFile(recentStage, "one millisecond recent stage");
        await utimes(exactProfile.filePath, new Date(cutoff), new Date(cutoff));
        await utimes(recentProfile.filePath, new Date(cutoff + 1), new Date(cutoff + 1));
        await utimes(exactStage, new Date(cutoff), new Date(cutoff));
        await utimes(recentStage, new Date(cutoff + 1), new Date(cutoff + 1));
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });

        expect(result.deleted).toBe(1);
        expect(result.staleTemporaryFilesDeleted).toBe(1);
        expect(result.tooRecent).toBe(1);
        await expect(lstat(exactProfile.filePath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(recentProfile.filePath)).resolves.toBeDefined();
        await expect(lstat(exactStage)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(recentStage)).resolves.toBeDefined();
    });

    it("keeps legacy profile files and public permalink uploads outside the GC scope", async () => {
        await createUserAsset("legacy-avatar.png", Buffer.from("legacy"));
        await createUserAsset("debug-permalink.png", Buffer.from("pinned user permalink"));
        await createAsset("uploads/debug-permalink.png", Buffer.from("pinned public permalink"));
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database);
        expect(result.scanned).toBe(0);
        await expect(readFile(getStoredPath("userassets", "legacy-avatar.png"))).resolves.toEqual(
            Buffer.from("legacy"),
        );
        await expect(readFile(getStoredPath("userassets", "debug-permalink.png"))).resolves.toEqual(
            Buffer.from("pinned user permalink"),
        );
        await expect(
            readFile(getStoredPath("assets", "uploads/debug-permalink.png")),
        ).resolves.toEqual(Buffer.from("pinned public permalink"));
    });

    it("refuses direct deletion of profile and content-addressed upload objects", async () => {
        const bytes = Buffer.from("permalink bytes");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const { relativePath: profilePath, filePath: profileFile } = await makeProfileAsset(bytes);
        const publicPath = `uploads/${digest}.png`;
        const userPublicPath = `${digest}.png`;
        await createAsset(publicPath, bytes);
        await createUserAsset(userPublicPath, bytes);

        await expect(removeUserAsset(profilePath)).rejects.toMatchObject({ statusCode: 409 });
        await expect(removeAsset(publicPath)).rejects.toMatchObject({ statusCode: 409 });
        await expect(removeUserAsset(userPublicPath)).rejects.toMatchObject({ statusCode: 409 });
        await expect(readFile(profileFile)).resolves.toEqual(bytes);
        await expect(readFile(getStoredPath("assets", publicPath))).resolves.toEqual(bytes);
        await expect(readFile(getStoredPath("userassets", userPublicPath))).resolves.toEqual(bytes);
    });

    it("cleans only old hidden profile staging files and leaves other temporary files alone", async () => {
        const profilesDirectory = join(storageRoot, "userassets", "profiles");
        await mkdir(profilesDirectory, { recursive: true });
        const staleProfileTemp = join(
            profilesDirectory,
            ".profile-12345678-1234-4234-8234-123456789abc.tmp",
        );
        const recentProfileTemp = join(
            profilesDirectory,
            ".profile-abcdefab-cdef-4abc-8def-abcdefabcdef.tmp",
        );
        const unrelatedTemp = join(profilesDirectory, ".upload-12345678.tmp");
        await writeFile(staleProfileTemp, "old");
        await writeFile(recentProfileTemp, "recent");
        await writeFile(unrelatedTemp, "unrelated");
        const now = Date.now();
        await utimes(staleProfileTemp, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.staleTemporaryFilesDeleted).toBe(1);
        await expect(lstat(staleProfileTemp)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(recentProfileTemp)).resolves.toBeDefined();
        await expect(lstat(unrelatedTemp)).resolves.toBeDefined();
    });

    it("removes only seven-day-old uncommitted multipart staging files", async () => {
        const staticStaging = join(storageRoot, "assets", ".staging");
        const userStaging = join(storageRoot, "userassets", ".staging");
        await mkdir(staticStaging, { recursive: true });
        await mkdir(userStaging, { recursive: true });
        const staleAssetStage = join(staticStaging, "12345678-1234-4234-8234-123456789abc.tmp");
        const staleWriteTemp = join(
            userStaging,
            ".upload-abcdefab-cdef-4abc-8def-abcdefabcdef.tmp",
        );
        const recentStage = join(userStaging, "abcdefab-cdef-4abc-8def-abcdefabcdef.tmp");
        await writeFile(staleAssetStage, "old staged object");
        await writeFile(staleWriteTemp, "old partial write");
        await writeFile(recentStage, "active staged object");
        const now = Date.now();
        await utimes(staleAssetStage, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));
        await utimes(staleWriteTemp, new Date(now - 8 * DAY_MS), new Date(now - 8 * DAY_MS));
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });
        expect(result.staleTemporaryFilesDeleted).toBe(2);
        await expect(lstat(staleAssetStage)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(staleWriteTemp)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(recentStage)).resolves.toBeDefined();
    });

    it("keeps old staging objects while their upload heartbeat is fresh", async () => {
        const stagingDirectory = join(storageRoot, "userassets", ".staging");
        const profilesDirectory = join(storageRoot, "userassets", "profiles");
        await mkdir(stagingDirectory, { recursive: true });
        await mkdir(profilesDirectory, { recursive: true });
        const stageId = "12345678-1234-4234-8234-123456789abc";
        const profileId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
        const stagedFile = join(stagingDirectory, `${stageId}.tmp`);
        const stagedLease = join(stagingDirectory, `.lease-${stageId}.tmp`);
        const profileTemp = join(profilesDirectory, `.profile-${profileId}.tmp`);
        const profileLease = join(profilesDirectory, `.profile-${profileId}.lease`);
        await writeFile(stagedFile, "active multipart upload");
        await writeFile(stagedLease, "lease");
        await writeFile(profileTemp, "active profile write");
        await writeFile(profileLease, "lease");
        const now = Date.now();
        const old = new Date(now - 8 * DAY_MS);
        await utimes(stagedFile, old, old);
        await utimes(profileTemp, old, old);
        const { database } = fakeDatabase();

        const result = await collectOrphanProfileAssets(database, { now });

        expect(result.staleTemporaryFilesDeleted).toBe(0);
        await expect(lstat(stagedFile)).resolves.toBeDefined();
        await expect(lstat(profileTemp)).resolves.toBeDefined();
    });

    it("keeps a live in-process staged upload when its on-disk heartbeat is stale", async () => {
        const stagedName = await stageAssetFromStream(
            Readable.from([Buffer.from("active upload")]),
            128,
            undefined,
            "assets",
        );
        const stagedPath = join(storageRoot, "assets", stagedName);
        const stagedId = stagedName.slice(".staging/".length, -".tmp".length);
        const leasePath = join(storageRoot, "assets", ".staging", `.lease-${stagedId}.tmp`);
        const stale = new Date(Date.now() - DAY_MS);
        await utimes(stagedPath, stale, stale);
        await utimes(leasePath, stale, stale);

        try {
            const { database } = fakeDatabase();
            const result = await collectOrphanProfileAssets(database, {
                now: Date.now() + 8 * DAY_MS,
            });

            expect(result.staleTemporaryFilesDeleted).toBe(0);
            await expect(lstat(stagedPath)).resolves.toBeDefined();
            await expect(lstat(leasePath)).resolves.toBeDefined();
        } finally {
            await discardStagedAsset(stagedName, "assets");
        }
    });

    it("limits actual directory entries visited even when no staging names are eligible", async () => {
        const stagingDirectory = join(storageRoot, "assets", ".staging");
        await mkdir(stagingDirectory, { recursive: true });
        await Promise.all(
            Array.from({ length: 40 }, (_, index) =>
                writeFile(join(stagingDirectory, `unmanaged-${index}.tmp`), "keep"),
            ),
        );
        const { database } = fakeDatabase();

        const first = await collectOrphanProfileAssets(database, { maxScanned: 8 });
        const second = await collectOrphanProfileAssets(database, { maxScanned: 8 });

        expect(first.entriesVisited).toBe(8);
        expect(second.entriesVisited).toBe(8);
        expect(first.staleTemporaryFilesDeleted + second.staleTemporaryFilesDeleted).toBe(0);
        expect(await readdir(stagingDirectory)).toHaveLength(40);
    });

    it("rotates bounded profile scans so later directory entries are reached", async () => {
        const contentSet = ["candidate-a", "candidate-b", "candidate-c", "candidate-d"];
        const assets = await Promise.all(
            contentSet.map((content) => makeProfileAsset(Buffer.from(content))),
        );
        const { database } = fakeDatabase();
        const now = Date.now();
        const old = new Date(now - 8 * DAY_MS);
        await Promise.all(assets.map(({ filePath }) => utimes(filePath, old, old)));

        const first = await collectOrphanProfileAssets(database, { now, maxScanned: 2 });
        const second = await collectOrphanProfileAssets(database, { now, maxScanned: 2 });

        expect(first.entriesVisited).toBeLessThanOrEqual(2);
        expect(second.entriesVisited).toBeLessThanOrEqual(2);
        expect(first.deleted + second.deleted).toBe(4);
    });

    it("bounds entries, deletions, and validates garbage-collection budgets", async () => {
        for (let index = 0; index < 4; index += 1) {
            await makeProfileAsset(Buffer.from(`candidate-${index}`));
        }
        const { database } = fakeDatabase();
        const bounded = await collectOrphanProfileAssets(database, {
            maxScanned: 2,
            maxDeletions: 1,
        });
        expect(bounded.entriesVisited).toBeLessThanOrEqual(2);
        expect(bounded.scanned).toBeLessThanOrEqual(2);
        expect(bounded.deleted).toBeLessThanOrEqual(1);
        await expect(collectOrphanProfileAssets(database, { maxScanned: 1001 })).rejects.toThrow(
            "maxScanned must be an integer",
        );
        await expect(collectOrphanProfileAssets(database, { maxDeletions: 101 })).rejects.toThrow(
            "maxDeletions must be an integer",
        );
        await expect(collectOrphanProfileAssets(database, { now: Number.NaN })).rejects.toThrow(
            "non-negative safe integer",
        );
    });
});
