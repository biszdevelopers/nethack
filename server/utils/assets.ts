import { constants, lstatSync, realpathSync } from "node:fs";
import { link, lstat, mkdir, opendir, open, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import {
    basename as fsBasename,
    dirname,
    isAbsolute,
    join,
    posix,
    relative,
    resolve,
    sep,
} from "node:path";
import { basename } from "node:path/posix";
import { createHash, randomUUID } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createError } from "h3";
import { and, asc, count, desc, eq, lte, or, sql } from "drizzle-orm";
import type { DrizzleDatabase } from "../database";
import { assetObjects, assetReferences, oauth2Applications, users } from "../database/schema";

export type AssetCollection = "assets" | "userassets";

const MIME_TYPES: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".zip": "application/zip",
};

const PROFILE_ASSET_PREFIX = "profiles/";
const PROFILE_ASSET_NAME = /^profiles\/[a-f0-9]{64}\.(?:gif|jpg|png|webp)$/;
const MIN_PROFILE_ASSET_GC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PROFILE_ASSET_GC_DELETIONS = 100;
const MAX_PROFILE_ASSET_GC_SCANNED = 1000;
const PROFILE_TEMP_NAME = /^\.profile-[a-f0-9-]{36}\.tmp$/i;
const STAGED_ASSET_NAME = /^\.staging\/[a-f0-9-]{36}\.tmp$/i;
const UPLOAD_TEMP_NAME = /^\.upload-[a-f0-9-]{36}\.tmp$/i;
const STAGED_UPLOAD_NAME = /^[a-f0-9-]{36}\.tmp$/i;
const UPLOAD_LEASE_NAME = /^\.lease-[a-f0-9-]{36}\.tmp$/i;
const PROFILE_TEMP_LEASE_NAME = /^\.profile-[a-f0-9-]{36}\.lease$/i;
const ASSET_LEASE_HEARTBEAT_MS = 30 * 1000;
const ASSET_LEASE_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const CONTENT_ADDRESSED_EXTENSIONS = new Set([
    "gif",
    "jpg",
    "json",
    "md",
    "mp4",
    "pdf",
    "png",
    "txt",
    "webp",
    "zip",
]);

/** Resolve existing symlink ancestors while allowing the final path to be absent. */
function canonicalizeConfiguredPath(path: string): string {
    let candidate = resolve(path);
    const missingSegments: string[] = [];

    while (true) {
        try {
            return resolve(realpathSync.native(candidate), ...missingSegments);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = dirname(candidate);
            if (parent === candidate) throw error;
            missingSegments.unshift(fsBasename(candidate));
            candidate = parent;
        }
    }
}

function isSameOrWithin(parent: string, candidate: string): boolean {
    const relativePath = relative(parent, candidate);
    return (
        !relativePath ||
        (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
    );
}

/** Defense-in-depth guard for paths passed into the private upload writer. */
export function assertAssetPathWithinRoot(root: string, filePath: string): void {
    if (!isSameOrWithin(root, filePath)) {
        throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
    }
}

/** Validate a caller-supplied private temporary name before creating it. */
export function assertUploadTemporaryName(temporaryName: string | undefined): void {
    if (temporaryName && !UPLOAD_TEMP_NAME.test(temporaryName)) {
        throw new Error("Invalid upload temporary name");
    }
}

function assertNoExistingSymlinkAncestors(projectRoot: string, candidate: string): void {
    // The only caller passes join(canonicalizeConfiguredPath(process.cwd()), "assets").
    // That construction guarantees containment; keep symlink and directory checks below.
    let current = projectRoot;
    const segments = relative(projectRoot, candidate).split(sep).filter(Boolean);
    for (const path of [
        projectRoot,
        ...segments.map((segment) => (current = join(current, segment))),
    ]) {
        try {
            const info = lstatSync(path);
            if (info.isSymbolicLink()) {
                throw new Error("Asset storage paths must not contain symbolic links");
            }
            if (!info.isDirectory()) {
                throw new Error("Asset storage paths must contain directories only");
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
    }
}

/** Resolve a persistent asset root inside the checked-out project directory. */
export function getAssetStorageRoot(): string {
    const projectRoot = canonicalizeConfiguredPath(process.cwd());
    // Tests may isolate files in their OS temp directory. Deployment always
    // ignores this legacy variable and stores at the checkout's /assets path.
    const testOverride =
        process.env.NODE_ENV === "test" ? process.env.ASSET_STORAGE_DIR?.trim() : undefined;
    if (testOverride) {
        if (!isAbsolute(testOverride)) {
            throw new Error("Test ASSET_STORAGE_DIR must be an absolute path");
        }
        return canonicalizeConfiguredPath(testOverride);
    }

    const storageRoot = join(projectRoot, "assets");
    assertNoExistingSymlinkAncestors(projectRoot, storageRoot);
    return storageRoot;
}

function collectionDirectory(collection: AssetCollection) {
    return join(getAssetStorageRoot(), collection);
}

async function ensureAssetStorageRootDirectory(): Promise<string> {
    const root = getAssetStorageRoot();
    await mkdir(root, { recursive: true, mode: 0o750 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        throw createError({ statusCode: 500, statusMessage: "Asset storage is unavailable" });
    }
    return root;
}

function sanitizeAssetName(name: string, allowHidden = false): string {
    if (
        typeof name !== "string" ||
        name.length === 0 ||
        name.length > 512 ||
        name.includes("\\") ||
        name.includes("\0")
    ) {
        throw createError({ statusCode: 400, statusMessage: "Invalid asset name" });
    }

    const segments = name.split("/");
    if (
        segments.some(
            (segment) =>
                !segment ||
                segment === "." ||
                segment === ".." ||
                (!allowHidden && segment.startsWith(".")),
        )
    ) {
        throw createError({ statusCode: 400, statusMessage: "Invalid asset name" });
    }
    return segments.join("/");
}

function resolveAssetPath(collection: AssetCollection, name: string, allowHidden = false) {
    const safeName = sanitizeAssetName(name, allowHidden);
    const directory = collectionDirectory(collection);
    const filePath = resolve(directory, ...safeName.split("/"));
    const pathFromDirectory = relative(directory, filePath);
    if (
        !pathFromDirectory ||
        pathFromDirectory === ".." ||
        pathFromDirectory.startsWith(`..${sep}`)
    ) {
        throw createError({ statusCode: 400, statusMessage: "Invalid asset name" });
    }
    return filePath;
}

async function ensureSafeParentDirectory(collection: AssetCollection, filePath: string) {
    const storageRoot = await ensureAssetStorageRootDirectory();
    const root = join(storageRoot, collection);
    await mkdir(root, { recursive: true, mode: 0o750 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        throw createError({ statusCode: 500, statusMessage: "Asset storage is unavailable" });
    }

    const parent = dirname(filePath);
    const pathFromRoot = relative(root, parent);
    let current = root;
    if (pathFromRoot && pathFromRoot !== ".") {
        for (const segment of pathFromRoot.split(sep)) {
            current = join(current, segment);
            try {
                await mkdir(current, { mode: 0o750 });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
            const info = await lstat(current);
            if (!info.isDirectory() || info.isSymbolicLink()) {
                throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
            }
        }
    }
}

/** Reject symlinked directories before reading, listing, or deleting stored assets. */
async function ensureNoSymlinkDirectories(collection: AssetCollection, directory: string) {
    const root = collectionDirectory(collection);
    if (!isSameOrWithin(root, directory)) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }
    const pathFromRoot = relative(root, directory);
    const directories = [root];
    if (pathFromRoot && pathFromRoot !== ".") {
        let current = root;
        for (const segment of pathFromRoot.split(sep)) {
            current = join(current, segment);
            directories.push(current);
        }
    }

    for (const path of directories) {
        let info;
        try {
            info = await lstat(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        if (info.isSymbolicLink()) {
            throw createError({ statusCode: 404, statusMessage: "Asset not found" });
        }
        if (!info.isDirectory()) return;
    }
}

export function getNoFollowFlag(value: number | undefined): number {
    return value ?? 0;
}

const noFollowFlag = getNoFollowFlag(constants.O_NOFOLLOW);
const activeAssetLeases = new Map<
    string,
    { handle: Awaited<ReturnType<typeof open>>; timer: NodeJS.Timeout }
>();
const profileGcCursors = new Map<string, string>();
const temporaryGcCursors = new Map<string, string>();

async function startAssetLease(collection: AssetCollection, leaseName: string): Promise<string> {
    const leasePath = resolveAssetPath(collection, leaseName, true);
    await ensureSafeParentDirectory(collection, leasePath);
    const handle = await open(
        leasePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag,
        0o600,
    );
    const info = await handle.stat();
    if (!info.isFile()) {
        await handle.close();
        await rm(leasePath, { force: true });
        throw new Error("Unable to create upload lease");
    }
    const timer = setInterval(() => {
        const now = new Date();
        void handle.utimes(now, now).catch(() => undefined);
    }, ASSET_LEASE_HEARTBEAT_MS);
    timer.unref?.();
    activeAssetLeases.set(leasePath, { handle, timer });
    return leasePath;
}

async function releaseAssetLease(leasePath: string): Promise<void> {
    // All callers release a lease returned by startAssetLease or resolveAssetPath.
    const activeLease = activeAssetLeases.get(leasePath);
    if (!activeLease) return;
    activeAssetLeases.delete(leasePath);
    clearInterval(activeLease.timer);
    await activeLease.handle.close().catch(() => undefined);
    await rm(leasePath, { force: true }).catch(() => undefined);
}

async function isAssetLeaseActive(
    collection: AssetCollection,
    leaseName: string,
    now: number,
): Promise<boolean> {
    const leasePath = resolveAssetPath(collection, leaseName, true);
    if (activeAssetLeases.has(leasePath)) return true;
    try {
        const info = await lstat(leasePath);
        // Treat malformed or symlinked leases as active. A collector must err
        // toward retaining a temporary file when it cannot prove the lease is stale.
        return (
            info.isSymbolicLink() ||
            !info.isFile() ||
            now - info.mtimeMs < ASSET_LEASE_ACTIVE_WINDOW_MS
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function writeAsset(
    collection: AssetCollection,
    name: string,
    data: Buffer,
): Promise<string> {
    const filePath = resolveAssetPath(collection, name);
    await ensureSafeParentDirectory(collection, filePath);

    try {
        const existing = await lstat(filePath);
        if (!existing.isFile() || existing.isSymbolicLink()) {
            throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const handle = await open(
        filePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag,
        0o640,
    );
    try {
        if (!(await handle.stat()).isFile()) {
            throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
        }
        await handle.writeFile(data);
    } finally {
        await handle.close();
    }
    return basename(name);
}

export async function createAsset(name: string, data: Buffer): Promise<string> {
    return writeAsset("assets", name, data);
}

export async function createUserAsset(name: string, data: Buffer): Promise<string> {
    return writeAsset("userassets", name, data);
}

function normalizeProfileAssetExtension(extension: string): string {
    if (typeof extension !== "string") {
        throw new Error("Profile asset extension is invalid");
    }
    const normalized = extension.toLowerCase().replace(/^\./, "");
    const canonical = normalized === "jpeg" ? "jpg" : normalized;
    if (!["gif", "jpg", "png", "webp"].includes(canonical)) {
        throw new Error("Profile asset extension is not supported");
    }
    return canonical;
}

const localAssetPublicationQueues = new Map<string, Promise<void>>();

async function withLocalAssetPublicationLock<T>(filePath: string, callback: () => Promise<T>) {
    const previous = localAssetPublicationQueues.get(filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
    });
    const queued = previous.then(() => current);
    localAssetPublicationQueues.set(filePath, queued);
    await previous;
    try {
        return await callback();
    } finally {
        release();
        if (localAssetPublicationQueues.get(filePath) === queued) {
            localAssetPublicationQueues.delete(filePath);
        }
    }
}

function isLinkPublicationFallbackError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === "EPERM" || code === "EXDEV";
}

/** Return the immutable, canonical path for a verified profile image's bytes. */
export function getUserAssetContentAddress(data: Buffer, extension: string): string {
    if (!Buffer.isBuffer(data) || data.length === 0) {
        throw new Error("Profile asset content must be a non-empty Buffer");
    }
    const canonicalExtension = normalizeProfileAssetExtension(extension);
    const digest = createHash("sha256").update(data).digest("hex");
    return `${PROFILE_ASSET_PREFIX}${digest}.${canonicalExtension}`;
}

async function verifyContentAddressedFile(filePath: string, data: Buffer): Promise<void> {
    const handle = await open(filePath, constants.O_RDONLY | noFollowFlag);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== data.length) {
            throw new Error("Existing content-addressed profile asset is invalid");
        }

        const hash = createHash("sha256");
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < info.size) {
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
            if (bytesRead === 0) break;
            const actual = chunk.subarray(0, bytesRead);
            if (!actual.equals(data.subarray(position, position + bytesRead))) {
                throw new Error("Content-addressed profile asset does not match its digest");
            }
            hash.update(actual);
            position += bytesRead;
        }
        if (
            position !== info.size ||
            hash.digest("hex") !== createHash("sha256").update(data).digest("hex")
        ) {
            throw new Error("Content-addressed profile asset does not match its digest");
        }
    } finally {
        await handle.close();
    }
}

/**
 * Publish a profile image at its content-addressed path without replacing an
 * existing object. Call this from inside `withAssetLifecycleLocks` together
 * with the corresponding database reference update.
 */
export async function createUserAssetContentAddressed(
    data: Buffer,
    extension: string,
): Promise<string> {
    const assetPath = getUserAssetContentAddress(data, extension);
    const filePath = resolveAssetPath("userassets", assetPath);
    await ensureSafeParentDirectory("userassets", filePath);

    const temporaryId = randomUUID();
    const temporaryName = `.profile-${temporaryId}.tmp`;
    const temporaryPath = join(dirname(filePath), temporaryName);
    const leasePath = await startAssetLease("userassets", `profiles/.profile-${temporaryId}.lease`);
    try {
        const temporaryHandle = await open(
            temporaryPath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag,
            0o640,
        );
        try {
            await temporaryHandle.writeFile(data);
            await temporaryHandle.sync();
        } finally {
            await temporaryHandle.close();
        }
        try {
            await link(temporaryPath, filePath);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "EEXIST") {
                await verifyContentAddressedFile(filePath, data);
            } else if (isLinkPublicationFallbackError(error)) {
                await withLocalAssetPublicationLock(filePath, async () => {
                    try {
                        await copyFileExclusively(
                            temporaryPath,
                            filePath,
                            createHash("sha256").update(data).digest("hex"),
                        );
                    } catch (fallbackError) {
                        if ((fallbackError as NodeJS.ErrnoException).code !== "EEXIST") {
                            throw fallbackError;
                        }
                        await verifyContentAddressedFile(filePath, data);
                    }
                });
            } else {
                throw error;
            }
        }
        return assetPath;
    } finally {
        try {
            await rm(temporaryPath, { force: true });
        } finally {
            await releaseAssetLease(leasePath);
        }
    }
}

type AssetLifecycleTransaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

function assetAdvisoryLockParts(assetPath: string): [number, number] {
    const digest = createHash("sha256").update("basishacks:asset:").update(assetPath).digest();
    return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Serialize object publication/reference updates and orphan collection for the
 * same paths. All database mutations and file publication for those paths must
 * happen in the callback's transaction.
 */
export async function withAssetLifecycleLocks<T>(
    database: DrizzleDatabase,
    assetPaths: readonly string[],
    callback: (transaction: AssetLifecycleTransaction) => Promise<T>,
): Promise<T> {
    const lockPaths = [...new Set(assetPaths.map((path) => sanitizeAssetName(path)))].sort();
    return database.transaction(async (transaction) => {
        for (const assetPath of lockPaths) {
            const [firstKey, secondKey] = assetAdvisoryLockParts(assetPath);
            await transaction.execute(sql`SELECT pg_advisory_xact_lock(${firstKey}, ${secondKey})`);
        }
        return callback(transaction);
    });
}

export interface ProfileAssetGcOptions {
    /** Current time in milliseconds, injectable for deterministic tests. */
    now?: number;
    /** Maximum number of profile objects to unlink in one invocation (1–100). */
    maxDeletions?: number;
    /** Maximum number of eligible directory entries evaluated per invocation (1–1000). */
    maxScanned?: number;
}

export interface ProfileAssetGcResult {
    entriesVisited: number;
    scanned: number;
    deleted: number;
    referenced: number;
    tooRecent: number;
    staleTemporaryFilesDeleted: number;
}

async function collectDirectoryWindow(
    directory: string,
    lastName: string | undefined,
    limit: number,
    maxEntries: number,
    isEligible: (name: string) => boolean,
    excluded = new Set<string>(),
): Promise<{
    names: string[];
    cursorFound: boolean;
    entriesVisited: number;
    lastVisited?: string;
}> {
    const names: string[] = [];
    let cursorFound = lastName === undefined;
    let entriesVisited = 0;
    let lastVisited: string | undefined;
    const entries = await opendir(directory);
    for await (const entry of entries) {
        entriesVisited += 1;
        lastVisited = entry.name;
        if (!cursorFound) {
            if (entry.name === lastName) cursorFound = true;
            if (entriesVisited >= maxEntries) break;
            continue;
        }
        if (isEligible(entry.name) && !excluded.has(entry.name)) {
            names.push(entry.name);
            if (names.length >= limit) break;
        }
        if (entriesVisited >= maxEntries) break;
    }
    return { names, cursorFound, entriesVisited, lastVisited };
}

async function collectDirectoryWindowUntil(
    directory: string,
    lastName: string,
    limit: number,
    maxEntries: number,
    isEligible: (name: string) => boolean,
    excluded: Set<string>,
): Promise<{ names: string[]; entriesVisited: number; lastVisited?: string }> {
    const names: string[] = [];
    let entriesVisited = 0;
    let lastVisited: string | undefined;
    const entries = await opendir(directory);
    for await (const entry of entries) {
        entriesVisited += 1;
        lastVisited = entry.name;
        if (entry.name === lastName) break;
        if (isEligible(entry.name) && !excluded.has(entry.name)) {
            names.push(entry.name);
            if (names.length >= limit) break;
        }
        if (entriesVisited >= maxEntries) break;
    }
    return { names, entriesVisited, lastVisited };
}

async function selectFairWindow(
    directory: string,
    cursors: Map<string, string>,
    cursorKey: string,
    limit: number,
    isEligible: (name: string) => boolean,
    maxEntries: number,
): { names: string[]; entriesVisited: number } {
    if (limit < 1 || maxEntries < 1) return { names: [], entriesVisited: 0 };
    const lastName = cursors.get(cursorKey);
    let { names, cursorFound, entriesVisited, lastVisited } = await collectDirectoryWindow(
        directory,
        lastName,
        limit,
        maxEntries,
        isEligible,
    );
    if (!cursorFound) {
        cursors.delete(cursorKey);
        return { names: [], entriesVisited };
    }
    if (names.length < limit && lastName !== undefined && entriesVisited < maxEntries) {
        const beforeCursor = await collectDirectoryWindowUntil(
            directory,
            lastName,
            limit - names.length,
            maxEntries - entriesVisited,
            isEligible,
            new Set(names),
        );
        names.push(...beforeCursor.names);
        entriesVisited += beforeCursor.entriesVisited;
        lastVisited = beforeCursor.lastVisited ?? lastVisited;
    }
    if (lastVisited) cursors.set(cursorKey, lastVisited);
    return { names, entriesVisited };
}

/**
 * Remove only content-addressed profile objects with no database references
 * and at least seven days of age. Public permalink uploads are outside this
 * collection and are deliberately never considered.
 */
export async function collectOrphanProfileAssets(
    database: DrizzleDatabase,
    options: ProfileAssetGcOptions = {},
): Promise<ProfileAssetGcResult> {
    const now = options.now ?? Date.now();
    const maxDeletions = options.maxDeletions ?? 25;
    const maxScanned = options.maxScanned ?? 250;
    if (!Number.isSafeInteger(now) || now < 0) {
        throw new Error("Profile asset GC time must be a non-negative safe integer");
    }
    if (
        !Number.isInteger(maxDeletions) ||
        maxDeletions < 1 ||
        maxDeletions > MAX_PROFILE_ASSET_GC_DELETIONS
    ) {
        throw new Error(
            `Profile asset GC maxDeletions must be an integer between 1 and ${MAX_PROFILE_ASSET_GC_DELETIONS}`,
        );
    }
    if (
        !Number.isInteger(maxScanned) ||
        maxScanned < 1 ||
        maxScanned > MAX_PROFILE_ASSET_GC_SCANNED
    ) {
        throw new Error(
            `Profile asset GC maxScanned must be an integer between 1 and ${MAX_PROFILE_ASSET_GC_SCANNED}`,
        );
    }

    const result: ProfileAssetGcResult = {
        entriesVisited: 0,
        scanned: 0,
        deleted: 0,
        referenced: 0,
        tooRecent: 0,
        staleTemporaryFilesDeleted: 0,
    };
    const cutoff = now - MIN_PROFILE_ASSET_GC_AGE_MS;
    const storageRoot = getAssetStorageRoot();
    const stagingQuota = Math.min(25, Math.floor(maxScanned / 4));
    const stagedCandidates: Array<{ collection: AssetCollection; name: string }> = [];
    for (const collection of ["assets", "userassets"] as const) {
        const stagingDirectory = resolveAssetPath(collection, ".staging", true);
        const stagingCursorKey = `${storageRoot}/${collection}/.staging`;
        await ensureNoSymlinkDirectories(collection, stagingDirectory);
        const quota = collection === "assets" ? Math.ceil(stagingQuota / 2) : stagingQuota;
        let selected: string[];
        try {
            const window = await selectFairWindow(
                stagingDirectory,
                temporaryGcCursors,
                stagingCursorKey,
                quota,
                (name) =>
                    STAGED_UPLOAD_NAME.test(name) ||
                    UPLOAD_TEMP_NAME.test(name) ||
                    UPLOAD_LEASE_NAME.test(name),
                maxScanned - result.entriesVisited,
            );
            result.entriesVisited += window.entriesVisited;
            selected = window.names;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") selected = [];
            else throw error;
        }
        for (const name of selected) stagedCandidates.push({ collection, name });
    }

    for (const { collection, name } of stagedCandidates) {
        const stagingCursorKey = `${storageRoot}/${collection}/.staging`;
        const stageMatch = name.match(STAGED_UPLOAD_NAME);
        const uploadMatch = name.match(UPLOAD_TEMP_NAME);
        const leaseMatch = name.match(UPLOAD_LEASE_NAME);
        // Every selected name has already matched one of the three upload-name
        // patterns above, each of which contains a UUID.
        const id =
            stageMatch?.[0].slice(0, -".tmp".length) ??
            uploadMatch?.[0].slice(".upload-".length, -".tmp".length) ??
            leaseMatch?.[0].slice(".lease-".length, -".tmp".length)!;
        const leaseName = `.staging/.lease-${id}.tmp`;
        if (await isAssetLeaseActive(collection, leaseName, now)) continue;
        const temporaryPath = resolveAssetPath(collection, `.staging/${name}`, true);
        try {
            const info = await lstat(temporaryPath);
            if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs <= cutoff) {
                await rm(temporaryPath);
                if (!leaseMatch) result.staleTemporaryFilesDeleted += 1;
                if (temporaryGcCursors.get(stagingCursorKey) === name) {
                    temporaryGcCursors.delete(stagingCursorKey);
                }
                await rm(resolveAssetPath(collection, leaseName, true), { force: true });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            if (leaseMatch) {
                await rm(temporaryPath, { force: true });
            }
        }
        if (result.deleted + result.staleTemporaryFilesDeleted >= maxDeletions) return result;
    }

    const profileDirectory = resolveAssetPath("userassets", "profiles");
    const profileCursorKey = `${storageRoot}/userassets/profiles`;
    await ensureNoSymlinkDirectories("userassets", profileDirectory);
    let profileCandidates: string[];
    try {
        const window = await selectFairWindow(
            profileDirectory,
            profileGcCursors,
            profileCursorKey,
            maxScanned - result.entriesVisited,
            (name) =>
                PROFILE_TEMP_NAME.test(name) ||
                PROFILE_TEMP_LEASE_NAME.test(name) ||
                PROFILE_ASSET_NAME.test(`${PROFILE_ASSET_PREFIX}${name}`),
            maxScanned - result.entriesVisited,
        );
        result.entriesVisited += window.entriesVisited;
        profileCandidates = window.names;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw error;
    }
    for (const name of profileCandidates) {
        if (PROFILE_TEMP_NAME.test(name) || PROFILE_TEMP_LEASE_NAME.test(name)) {
            const tempMatch = name.match(PROFILE_TEMP_NAME);
            const leaseMatch = name.match(PROFILE_TEMP_LEASE_NAME);
            // Selected profile temporary names are UUID-addressed by the same
            // patterns used to select these candidates.
            const id =
                tempMatch?.[0].slice(".profile-".length, -".tmp".length) ??
                leaseMatch?.[0].slice(".profile-".length, -".lease".length)!;
            const leaseName = `profiles/.profile-${id}.lease`;
            if (await isAssetLeaseActive("userassets", leaseName, now)) continue;
            const tempPath = resolveAssetPath("userassets", `profiles/.profile-${id}.tmp`, true);
            try {
                const info = await lstat(tempPath);
                if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs <= cutoff) {
                    await rm(tempPath);
                    result.staleTemporaryFilesDeleted += 1;
                    if (profileGcCursors.get(profileCursorKey) === name) {
                        profileGcCursors.delete(profileCursorKey);
                    }
                    await rm(resolveAssetPath("userassets", leaseName, true), { force: true });
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                if (leaseMatch)
                    await rm(resolveAssetPath("userassets", leaseName, true), { force: true });
            }
            if (result.deleted + result.staleTemporaryFilesDeleted >= maxDeletions) break;
            continue;
        }
        result.scanned += 1;
        const assetPath = `${PROFILE_ASSET_PREFIX}${name}`;
        const filePath = resolveAssetPath("userassets", assetPath);
        const outcome = await withAssetLifecycleLocks(
            database,
            [assetPath],
            async (transaction) => {
                await ensureNoSymlinkDirectories("userassets", dirname(filePath));
                let fileInfo;
                try {
                    fileInfo = await lstat(filePath);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT")
                        return "missing" as const;
                    throw error;
                }
                if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return "missing" as const;
                if (fileInfo.mtimeMs > cutoff) return "tooRecent" as const;

                const profileReference = await transaction
                    .select({ id: users.id })
                    .from(users)
                    .where(
                        or(
                            eq(users.profile_picture, assetPath),
                            eq(users.profile_theme, `url|${assetPath}`),
                        ),
                    )
                    .limit(1);
                if (profileReference.length > 0) return "referenced" as const;

                const oauthReference = await transaction
                    .select({ client_id: oauth2Applications.client_id })
                    .from(oauth2Applications)
                    .where(eq(oauth2Applications.profile_picture, assetPath))
                    .limit(1);
                if (oauthReference.length > 0) return "referenced" as const;

                await rm(filePath);
                return "deleted" as const;
            },
        );

        if (outcome === "deleted") {
            result.deleted += 1;
            if (profileGcCursors.get(profileCursorKey) === name) {
                profileGcCursors.delete(profileCursorKey);
            }
        } else if (outcome === "missing") {
            if (profileGcCursors.get(profileCursorKey) === name) {
                profileGcCursors.delete(profileCursorKey);
            }
        } else if (outcome === "referenced") result.referenced += 1;
        else {
            // The callback returns only deleted, missing, referenced, or tooRecent.
            result.tooRecent += 1;
        }
        if (result.deleted + result.staleTemporaryFilesDeleted >= maxDeletions) break;
    }
    return result;
}

/** Stream one bounded upload to a temporary file and publish it atomically. */
export async function createAssetFromStream(
    name: string,
    input: Readable,
    maxBytes: number,
    validatePrefix?: (prefix: Buffer) => boolean,
    collection: AssetCollection = "assets",
    /** Use exclusive hard-link publication when false, so an existing path is never replaced. */
    overwriteExisting = true,
): Promise<string> {
    const filePath = resolveAssetPath(collection, name);
    return createStreamAtPath(
        filePath,
        basename(name),
        input,
        maxBytes,
        validatePrefix,
        overwriteExisting,
    );
}

async function copyFileExclusively(
    sourcePath: string,
    destinationPath: string,
    expectedDigest?: string,
): Promise<void> {
    let source;
    let destination;
    let destinationCreated = false;
    try {
        source = await open(sourcePath, constants.O_RDONLY | noFollowFlag);
        const sourceInfo = await source.stat();
        if (!sourceInfo.isFile()) throw new Error("Asset source is not a regular file");
        destination = await open(
            destinationPath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag,
            0o640,
        );
        destinationCreated = true;
        const digest = expectedDigest ? createHash("sha256") : undefined;
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < sourceInfo.size) {
            const { bytesRead } = await source.read(chunk, 0, chunk.length, position);
            if (bytesRead === 0) break;
            const data = chunk.subarray(0, bytesRead);
            digest?.update(data);
            let written = 0;
            while (written < bytesRead) {
                const result = await destination.write(data, written, bytesRead - written, null);
                if (result.bytesWritten === 0) throw new Error("Unable to copy stored asset");
                written += result.bytesWritten;
            }
            position += bytesRead;
        }
        if (
            position !== sourceInfo.size ||
            (expectedDigest !== undefined && digest?.digest("hex") !== expectedDigest)
        ) {
            throw new Error("Staged asset changed before publication");
        }
        await destination.sync();
        await destination.close();
        destination = undefined;
    } catch (error) {
        await destination?.close().catch(() => undefined);
        if (destinationCreated) await rm(destinationPath, { force: true }).catch(() => undefined);
        throw error;
    } finally {
        await source?.close();
    }
}

async function createStreamAtPath(
    filePath: string,
    returnedName: string,
    input: Readable,
    maxBytes: number,
    validatePrefix?: (prefix: Buffer) => boolean,
    overwriteExisting = true,
    temporaryName?: string,
): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error("maxBytes must be a positive safe integer");
    }
    const parent = dirname(filePath);
    const root = await ensureAssetStorageRootDirectory();
    assertAssetPathWithinRoot(root, filePath);
    let current = root;
    const relativeParent = relative(root, parent);
    for (const segment of relativeParent.split(sep).filter(Boolean)) {
        current = join(current, segment);
        try {
            await mkdir(current, { mode: 0o750 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) {
            throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
        }
    }
    assertUploadTemporaryName(temporaryName);
    const temporaryPath = join(dirname(filePath), temporaryName ?? `.upload-${randomUUID()}.tmp`);
    let bytesWritten = 0;
    let exceededLimit = false;
    const sizeGuard = new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
            bytesWritten += Buffer.byteLength(chunk);
            if (bytesWritten > maxBytes) {
                exceededLimit = true;
                callback();
                return;
            }
            callback(null, chunk);
        },
    });

    let prefixChecked = !validatePrefix;
    let prefix = Buffer.alloc(0);
    const prefixGuard = validatePrefix
        ? new Transform({
              decodeStrings: false,
              transform(chunk: Buffer | string, _encoding, callback) {
                  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                  if (prefixChecked) {
                      callback(null, buffer);
                      return;
                  }
                  const bytesNeeded = 16 - prefix.length;
                  const part = buffer.subarray(0, bytesNeeded);
                  prefix = Buffer.concat([prefix, part]);
                  if (prefix.length < 16) {
                      callback();
                      return;
                  }
                  if (!validatePrefix(prefix)) {
                      callback(
                          createError({ statusCode: 400, statusMessage: "Invalid file content" }),
                      );
                      return;
                  }
                  prefixChecked = true;
                  this.push(prefix);
                  callback(null, buffer.subarray(part.length));
              },
              flush(callback) {
                  if (!prefixChecked) {
                      callback(
                          createError({
                              statusCode: 400,
                              statusMessage: "Invalid file content",
                          }),
                      );
                      return;
                  }
                  callback();
              },
          })
        : undefined;

    try {
        const destination = createWriteStream(temporaryPath, { flags: "wx", mode: 0o640 });
        if (prefixGuard) await pipeline(input, prefixGuard, sizeGuard, destination);
        else await pipeline(input, sizeGuard, destination);
        if (exceededLimit) {
            throw createError({ statusCode: 413, statusMessage: "File too large" });
        }
        if (overwriteExisting) {
            try {
                const existing = await lstat(filePath);
                if (!existing.isFile() || existing.isSymbolicLink()) {
                    throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            await rename(temporaryPath, filePath);
        } else {
            // Hard-link publication is atomic and fails with EEXIST if any
            // destination appears after the caller's collision check.
            try {
                await link(temporaryPath, filePath);
            } catch (error) {
                if (!isLinkPublicationFallbackError(error)) {
                    throw error;
                }
                await copyFileExclusively(temporaryPath, filePath);
            }
            await rm(temporaryPath);
        }
        return returnedName;
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if ((error as { statusCode?: number })?.statusCode === 413) throw error;
        throw error;
    }
}

function normalizeContentAddressExtension(extension: string): string {
    if (typeof extension !== "string") throw new Error("Asset extension is invalid");
    const normalized = extension.toLowerCase().replace(/^\./, "");
    const canonical = normalized === "jpeg" ? "jpg" : normalized;
    if (!CONTENT_ADDRESSED_EXTENSIONS.has(canonical)) {
        throw new Error("Asset extension is not supported");
    }
    return canonical;
}

async function hashRegularFile(filePath: string): Promise<{ digest: string; size: number }> {
    const handle = await open(filePath, constants.O_RDONLY | noFollowFlag);
    try {
        const initial = await handle.stat();
        if (!initial.isFile()) throw new Error("Asset object is not a regular file");
        const digest = createHash("sha256");
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < initial.size) {
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
            if (bytesRead === 0) break;
            digest.update(chunk.subarray(0, bytesRead));
            position += bytesRead;
        }
        const final = await handle.stat();
        if (
            position !== initial.size ||
            final.size !== initial.size ||
            final.mtimeMs !== initial.mtimeMs
        ) {
            throw new Error("Asset object changed while it was being hashed");
        }
        return { digest: digest.digest("hex"), size: initial.size };
    } finally {
        await handle.close();
    }
}

async function assertFilesMatch(leftPath: string, rightPath: string, expectedDigest: string) {
    const left = await open(leftPath, constants.O_RDONLY | noFollowFlag);
    let right;
    try {
        right = await open(rightPath, constants.O_RDONLY | noFollowFlag);
        const leftInfo = await left.stat();
        const rightInfo = await right.stat();
        if (!leftInfo.isFile() || !rightInfo.isFile() || leftInfo.size !== rightInfo.size) {
            throw new Error("Content-addressed asset path collision");
        }

        const leftChunk = Buffer.allocUnsafe(64 * 1024);
        const rightChunk = Buffer.allocUnsafe(64 * 1024);
        const digest = createHash("sha256");
        let position = 0;
        while (position < leftInfo.size) {
            const [leftResult, rightResult] = await Promise.all([
                left.read(leftChunk, 0, leftChunk.length, position),
                right.read(rightChunk, 0, rightChunk.length, position),
            ]);
            if (
                leftResult.bytesRead === 0 ||
                leftResult.bytesRead !== rightResult.bytesRead ||
                !leftChunk
                    .subarray(0, leftResult.bytesRead)
                    .equals(rightChunk.subarray(0, rightResult.bytesRead))
            ) {
                throw new Error("Content-addressed asset path collision");
            }
            digest.update(leftChunk.subarray(0, leftResult.bytesRead));
            position += leftResult.bytesRead;
        }
        if (digest.digest("hex") !== expectedDigest) {
            throw new Error("Content-addressed asset digest mismatch");
        }
    } finally {
        await left.close();
        await right?.close();
    }
}

/** Stream a multipart part to a private, hidden staging path with bounded memory. */
export async function stageAssetFromStream(
    input: Readable,
    maxBytes: number,
    validatePrefix: ((prefix: Buffer) => boolean) | undefined,
    collection: AssetCollection,
): Promise<string> {
    const stageId = randomUUID();
    const stagedName = `.staging/${stageId}.tmp`;
    const stagedPath = resolveAssetPath(collection, stagedName, true);
    const leasePath = await startAssetLease(collection, `.staging/.lease-${stageId}.tmp`);
    try {
        await createStreamAtPath(
            stagedPath,
            stagedName,
            input,
            maxBytes,
            validatePrefix,
            false,
            `.upload-${stageId}.tmp`,
        );
        return stagedName;
    } catch (error) {
        await releaseAssetLease(leasePath);
        throw error;
    }
}

/** Hash and atomically publish a completed staged upload without overwriting. */
export async function publishStagedAssetContentAddressed(
    stagedName: string,
    extension: string,
    collection: AssetCollection,
    referenceContext?: { database: DrizzleDatabase; createdBy: number },
): Promise<{ filename: string; relativePath: string; referenceId?: string }> {
    if (!STAGED_ASSET_NAME.test(stagedName)) throw new Error("Invalid staged asset token");
    const stageId = stagedName.slice(".staging/".length, -".tmp".length);
    const stagedPath = resolveAssetPath(collection, stagedName, true);
    const leasePath = resolveAssetPath(collection, `.staging/.lease-${stageId}.tmp`, true);
    try {
        const canonicalExtension = normalizeContentAddressExtension(extension);
        const { digest, size } = await hashRegularFile(stagedPath);
        const filename = `${digest}.${canonicalExtension}`;
        const relativePath = collection === "assets" ? `uploads/${filename}` : filename;
        const destinationPath = resolveAssetPath(collection, relativePath);
        await ensureSafeParentDirectory(collection, destinationPath);

        const publish = async (): Promise<boolean> => {
            try {
                await link(stagedPath, destinationPath);
                return true;
            } catch (error) {
                if (isLinkPublicationFallbackError(error)) {
                    try {
                        await copyFileExclusively(stagedPath, destinationPath, digest);
                        return true;
                    } catch (copyError) {
                        if ((copyError as NodeJS.ErrnoException).code !== "EEXIST") throw copyError;
                        await assertFilesMatch(stagedPath, destinationPath, digest);
                        return false;
                    }
                }
                if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                    await assertFilesMatch(stagedPath, destinationPath, digest);
                    return false;
                }
                throw error;
            }
        };

        if (!referenceContext) {
            await publish();
            return { filename, relativePath };
        }

        const referenceId = randomUUID();
        const lockName = `${collection}/${relativePath}`;
        await withAssetLifecycleLocks(
            referenceContext.database,
            [lockName],
            async (transaction) => {
                const existingObject = (
                    await transaction
                        .select()
                        .from(assetObjects)
                        .where(
                            and(
                                eq(assetObjects.collection, collection),
                                eq(assetObjects.asset_path, relativePath),
                            ),
                        )
                        .limit(1)
                )[0];
                const created = await publish();
                if (existingObject) {
                    if (existingObject.sha256 !== digest || existingObject.byte_size !== size) {
                        throw new Error(
                            "Registered asset metadata does not match its content hash",
                        );
                    }
                    await transaction
                        .update(assetObjects)
                        .set({ unreferenced_at: null })
                        .where(
                            and(
                                eq(assetObjects.collection, collection),
                                eq(assetObjects.asset_path, relativePath),
                            ),
                        );
                } else {
                    await transaction.insert(assetObjects).values({
                        collection,
                        asset_path: relativePath,
                        sha256: digest,
                        byte_size: size,
                        // An object already on disk but absent from the registry may
                        // have old public URLs that cannot be enumerated safely.
                        pinned: !created,
                        unreferenced_at: null,
                    });
                }
                await transaction.insert(assetReferences).values({
                    id: referenceId,
                    collection,
                    asset_path: relativePath,
                    reference_type: "permalink",
                    created_by: referenceContext.createdBy,
                });
            },
        );
        return { filename, relativePath, referenceId };
    } finally {
        // A published content-addressed object is immutable and may already be
        // shared by another permalink. Only the private staging name is removed.
        try {
            await rm(stagedPath, { force: true });
            await rm(resolveAssetPath(collection, `.staging/.upload-${stageId}.tmp`, true), {
                force: true,
            });
        } catch {
            // Retain any staging residue if storage is temporarily unavailable;
            // the lease is still released so the aged-file collector can retry.
        } finally {
            await releaseAssetLease(leasePath);
        }
    }
}

/** Release only the caller's permalink, unless the caller has admin access. */
export async function releaseAssetReference(
    database: DrizzleDatabase,
    referenceId: string,
    requesterId: number,
    isAdmin = false,
    now = new Date(),
): Promise<boolean> {
    const reference = (
        await database
            .select()
            .from(assetReferences)
            .where(eq(assetReferences.id, referenceId))
            .limit(1)
    )[0];
    if (!reference || (!isAdmin && reference.created_by !== requesterId)) return false;

    const lockName = `${reference.collection}/${reference.asset_path}`;
    return withAssetLifecycleLocks(database, [lockName], async (transaction) => {
        const current = (
            await transaction
                .select()
                .from(assetReferences)
                .where(eq(assetReferences.id, referenceId))
                .limit(1)
        )[0];
        if (!current || (!isAdmin && current.created_by !== requesterId)) return false;

        await transaction.delete(assetReferences).where(eq(assetReferences.id, referenceId));
        const remainingReference = (
            await transaction
                .select({ id: assetReferences.id })
                .from(assetReferences)
                .where(
                    and(
                        eq(assetReferences.collection, current.collection),
                        eq(assetReferences.asset_path, current.asset_path),
                    ),
                )
                .limit(1)
        )[0];
        if (!remainingReference) {
            await transaction
                .update(assetObjects)
                .set({ unreferenced_at: now })
                .where(
                    and(
                        eq(assetObjects.collection, current.collection),
                        eq(assetObjects.asset_path, current.asset_path),
                        eq(assetObjects.pinned, false),
                    ),
                );
        }
        return true;
    });
}

export interface AssetReferenceListOptions {
    page: number;
    pageSize: number;
}

/** List active permalink references owned by a user, or all references for an admin. */
export async function listAssetReferences(
    database: DrizzleDatabase,
    requesterId: number,
    isAdmin: boolean,
    options: AssetReferenceListOptions,
) {
    const ownerFilter = isAdmin ? undefined : eq(assetReferences.created_by, requesterId);
    const [countRows, rows] = await Promise.all([
        database.select({ total: count() }).from(assetReferences).where(ownerFilter),
        database
            .select({
                id: assetReferences.id,
                collection: assetReferences.collection,
                asset_path: assetReferences.asset_path,
                created_at: assetReferences.created_at,
            })
            .from(assetReferences)
            .where(ownerFilter)
            .orderBy(desc(assetReferences.created_at), desc(assetReferences.id))
            .limit(options.pageSize)
            .offset((options.page - 1) * options.pageSize),
    ]);
    const total = Number(countRows[0]?.total ?? 0);

    return {
        items: rows.map((reference) => {
            const encodedPath = reference.asset_path
                .split("/")
                .map((segment) => encodeURIComponent(segment))
                .join("/");
            const permalink =
                reference.collection === "assets"
                    ? `/assets/${encodedPath}`
                    : reference.collection === "userassets"
                      ? `/userast/${encodedPath}`
                      : null;
            if (!permalink) {
                throw new Error("Stored asset reference has an unsupported collection");
            }
            return { ...reference, permalink };
        }),
        page: options.page,
        page_size: options.pageSize,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / options.pageSize),
    };
}

export interface PermalinkAssetGcOptions {
    now?: number;
    maxDeletions?: number;
    maxScanned?: number;
}

export interface PermalinkAssetGcResult {
    scanned: number;
    deleted: number;
    missing: number;
    referenced: number;
    unsafe: number;
}

/** Collect only registry-managed, unpinned permalinks with no references for seven days. */
export async function collectOrphanPermalinkAssets(
    database: DrizzleDatabase,
    options: PermalinkAssetGcOptions = {},
): Promise<PermalinkAssetGcResult> {
    const now = options.now ?? Date.now();
    const maxDeletions = options.maxDeletions ?? 25;
    const maxScanned = options.maxScanned ?? 250;
    if (!Number.isSafeInteger(now) || now < 0) {
        throw new Error("Permalink asset GC time must be a non-negative safe integer");
    }
    if (!Number.isInteger(maxDeletions) || maxDeletions < 1 || maxDeletions > 100) {
        throw new Error("Permalink asset GC maxDeletions must be an integer between 1 and 100");
    }
    if (!Number.isInteger(maxScanned) || maxScanned < 1 || maxScanned > 1000) {
        throw new Error("Permalink asset GC maxScanned must be an integer between 1 and 1000");
    }

    const cutoff = new Date(now - MIN_PROFILE_ASSET_GC_AGE_MS);
    const candidates = await database
        .select({ collection: assetObjects.collection, asset_path: assetObjects.asset_path })
        .from(assetObjects)
        .where(and(eq(assetObjects.pinned, false), lte(assetObjects.unreferenced_at, cutoff)))
        .orderBy(
            asc(assetObjects.unreferenced_at),
            asc(assetObjects.collection),
            asc(assetObjects.asset_path),
        )
        .limit(maxScanned);
    const result: PermalinkAssetGcResult = {
        scanned: 0,
        deleted: 0,
        missing: 0,
        referenced: 0,
        unsafe: 0,
    };

    for (const candidate of candidates) {
        result.scanned += 1;
        const lockName = `${candidate.collection}/${candidate.asset_path}`;
        const outcome = await withAssetLifecycleLocks(database, [lockName], async (transaction) => {
            const object = (
                await transaction
                    .select()
                    .from(assetObjects)
                    .where(
                        and(
                            eq(assetObjects.collection, candidate.collection),
                            eq(assetObjects.asset_path, candidate.asset_path),
                            eq(assetObjects.pinned, false),
                            lte(assetObjects.unreferenced_at, cutoff),
                        ),
                    )
                    .limit(1)
            )[0];
            if (!object) return "missing" as const;

            const reference = (
                await transaction
                    .select({ id: assetReferences.id })
                    .from(assetReferences)
                    .where(
                        and(
                            eq(assetReferences.collection, candidate.collection),
                            eq(assetReferences.asset_path, candidate.asset_path),
                        ),
                    )
                    .limit(1)
            )[0];
            if (reference) {
                await transaction
                    .update(assetObjects)
                    .set({ unreferenced_at: null })
                    .where(
                        and(
                            eq(assetObjects.collection, candidate.collection),
                            eq(assetObjects.asset_path, candidate.asset_path),
                        ),
                    );
                return "referenced" as const;
            }

            const filePath = resolveAssetPath(
                candidate.collection as AssetCollection,
                candidate.asset_path,
            );
            await ensureNoSymlinkDirectories(
                candidate.collection as AssetCollection,
                dirname(filePath),
            );
            let fileInfo;
            try {
                fileInfo = await lstat(filePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            if (fileInfo && (!fileInfo.isFile() || fileInfo.isSymbolicLink())) {
                return "unsafe" as const;
            }
            if (fileInfo) await rm(filePath);
            await transaction
                .delete(assetObjects)
                .where(
                    and(
                        eq(assetObjects.collection, candidate.collection),
                        eq(assetObjects.asset_path, candidate.asset_path),
                    ),
                );
            return fileInfo ? ("deleted" as const) : ("missing" as const);
        });

        if (outcome === "deleted") result.deleted += 1;
        else if (outcome === "referenced") result.referenced += 1;
        else if (outcome === "unsafe") result.unsafe += 1;
        else result.missing += 1;
        if (result.deleted >= maxDeletions) break;
    }
    return result;
}

/** Delete only a private multipart staging object; never accept published paths. */
export async function discardStagedAsset(
    stagedName: string | undefined,
    collection: AssetCollection,
): Promise<void> {
    if (!stagedName) return;
    if (!STAGED_ASSET_NAME.test(stagedName)) throw new Error("Invalid staged asset token");
    const stagedPath = resolveAssetPath(collection, stagedName, true);
    const stageId = stagedName.slice(".staging/".length, -".tmp".length);
    const leasePath = resolveAssetPath(collection, `.staging/.lease-${stageId}.tmp`, true);
    try {
        await ensureNoSymlinkDirectories(collection, dirname(stagedPath));
        await rm(stagedPath, { force: true });
        await rm(resolveAssetPath(collection, `.staging/.upload-${stageId}.tmp`, true), {
            force: true,
        });
    } finally {
        await releaseAssetLease(leasePath);
    }
}

async function removeAssetFromCollection(
    collection: AssetCollection,
    name: string | null | undefined,
) {
    if (!name) return;
    const safeName = sanitizeAssetName(name);
    const managedAsset =
        (collection === "assets" && /^uploads\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(safeName)) ||
        (collection === "userassets" &&
            (/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(safeName) ||
                /^profiles\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(safeName)));
    if (managedAsset) {
        throw createError({
            statusCode: 409,
            statusMessage: "Content-addressed assets cannot be removed directly",
        });
    }
    const filePath = resolveAssetPath(collection, safeName);
    await ensureNoSymlinkDirectories(collection, dirname(filePath));
    try {
        await rm(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

export async function removeAsset(name: string | null | undefined) {
    await removeAssetFromCollection("assets", name);
}

export async function removeUserAsset(name: string | null | undefined) {
    await removeAssetFromCollection("userassets", name);
}

export async function getStoredAssetNames(
    collection: AssetCollection,
    subdirectory?: string,
): Promise<string[]> {
    const directory = subdirectory
        ? resolveAssetPath(collection, subdirectory)
        : collectionDirectory(collection);
    await ensureNoSymlinkDirectories(collection, directory);
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

export async function openStoredAsset(collection: AssetCollection, name: string) {
    const filePath = resolveAssetPath(collection, name);
    await ensureNoSymlinkDirectories(collection, dirname(filePath));
    const entry = await lstat(filePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }
    const handle = await open(filePath, constants.O_RDONLY | noFollowFlag);
    const info = await handle.stat();
    if (!info.isFile()) {
        await handle.close();
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }
    return { stream: handle.createReadStream(), size: info.size };
}

export async function getUserAsset(name: string): Promise<Buffer> {
    const { stream } = await openStoredAsset("userassets", name);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

export function assetContentType(name: string): string {
    const extension = posix.extname(name).toLowerCase();
    return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function isInlineSafeAsset(name: string): boolean {
    return new Set([".gif", ".jpeg", ".jpg", ".mp4", ".png", ".webp"]).has(
        posix.extname(name).toLowerCase(),
    );
}
