import { constants, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
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
import { randomUUID } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createError } from "h3";

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

/**
 * Uploads live outside the release tree by default. Set ASSET_STORAGE_DIR to an
 * absolute, persistent directory when deploying (for example, /var/lib/basishacks/assets).
 */
export function getAssetStorageRoot(): string {
    const configured = process.env.ASSET_STORAGE_DIR?.trim();
    let storageRoot: string;
    if (configured) {
        if (!isAbsolute(configured)) {
            throw new Error("ASSET_STORAGE_DIR must be an absolute path");
        }
        storageRoot = resolve(configured);
    } else {
        const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
        const dataHome =
            xdgDataHome && isAbsolute(xdgDataHome)
                ? xdgDataHome
                : join(homedir(), ".local", "share");
        storageRoot = join(dataHome, "basishacks", "assets");
    }

    if (process.env.NODE_ENV === "production") {
        const canonicalReleaseRoot = canonicalizeConfiguredPath(process.cwd());
        const canonicalStorageRoot = canonicalizeConfiguredPath(storageRoot);
        if (isSameOrWithin(canonicalReleaseRoot, canonicalStorageRoot)) {
            throw new Error(
                "ASSET_STORAGE_DIR must be outside the application release directory in production",
            );
        }
    }
    return storageRoot;
}

function collectionDirectory(collection: AssetCollection) {
    return join(getAssetStorageRoot(), collection);
}

function sanitizeAssetName(name: string): string {
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
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw createError({ statusCode: 400, statusMessage: "Invalid asset name" });
    }
    return segments.join("/");
}

function resolveAssetPath(collection: AssetCollection, name: string) {
    const safeName = sanitizeAssetName(name);
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
    const root = collectionDirectory(collection);
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

function noFollowFlag() {
    return constants.O_NOFOLLOW ?? 0;
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
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag(),
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

/** Stream one bounded upload to a temporary file and publish it atomically. */
export async function createAssetFromStream(
    name: string,
    input: Readable,
    maxBytes: number,
    validatePrefix?: (prefix: Buffer) => boolean,
    collection: AssetCollection = "assets",
): Promise<string> {
    const filePath = resolveAssetPath(collection, name);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error("maxBytes must be a positive safe integer");
    }
    await ensureSafeParentDirectory(collection, filePath);
    const temporaryPath = join(dirname(filePath), `.upload-${randomUUID()}.tmp`);
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
                      if (buffer.length > part.length) {
                          callback(
                              createError({
                                  statusCode: 400,
                                  statusMessage: "Invalid file content",
                              }),
                          );
                          return;
                      }
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
                  if (!prefixChecked && !validatePrefix(prefix)) {
                      callback(
                          createError({ statusCode: 400, statusMessage: "Invalid file content" }),
                      );
                      return;
                  }
                  if (!prefixChecked && prefix.length > 0) this.push(prefix);
                  prefixChecked = true;
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
        if (!prefixChecked) {
            throw createError({ statusCode: 400, statusMessage: "Invalid file content" });
        }
        try {
            const existing = await lstat(filePath);
            if (!existing.isFile() || existing.isSymbolicLink()) {
                throw createError({ statusCode: 400, statusMessage: "Invalid asset path" });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temporaryPath, filePath);
        return basename(name);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if ((error as { statusCode?: number })?.statusCode === 413) throw error;
        throw error;
    }
}

async function removeAssetFromCollection(
    collection: AssetCollection,
    name: string | null | undefined,
) {
    if (!name) return;
    const filePath = resolveAssetPath(collection, name);
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
    const entry = await lstat(filePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }
    const handle = await open(filePath, constants.O_RDONLY | noFollowFlag());
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
