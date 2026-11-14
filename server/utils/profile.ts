import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import jdenticon from "jdenticon";
import fetch from "node-fetch";

const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
};

const PROVIDER_IMAGE_TYPES = new Set(Object.keys(extensionByType));

function cachePath(cacheKey: string, extension: string) {
    const root = process.env.BASIS_AUTH_PICTURE_CACHE_DIR?.trim() || "assets/basis-auth-pictures";
    return resolve(root, `${cacheKey}.${extension}`);
}

async function readCachedPicture(cacheKey: string) {
    for (const [contentType, extension] of Object.entries(extensionByType)) {
        try {
            const bytes = await readFile(cachePath(cacheKey, extension));
            if (bytes.length > 0) return { bytes, contentType };
        } catch {
            // Try the next cached extension.
        }
    }
    return undefined;
}

async function writeCachedPicture(cacheKey: string, contentType: string, bytes: Buffer) {
    // Callers reject types outside PROVIDER_IMAGE_TYPES, so the extension always exists.
    const extension = extensionByType[contentType]!;
    try {
        const path = cachePath(cacheKey, extension);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, path);
    } catch {
        // The provider remains authoritative; a cache failure must not break the response.
    }
}

export function getBasisAuthPictureUrl(
    value: unknown,
    issuer: string | undefined,
): string | undefined {
    if (typeof value !== "string" || !issuer) return undefined;
    const picture = URL.parse(value);
    const origin = URL.parse(issuer)?.origin;
    if (
        !picture ||
        (picture.protocol !== "https:" && picture.protocol !== "http:") ||
        picture.origin !== origin ||
        picture.username ||
        picture.password
    )
        return undefined;
    return picture.href;
}

export async function fetchBasisAuthPicture(url: string, cacheKey?: string) {
    const safeCacheKey = cacheKey && /^\d+$/.test(cacheKey) ? cacheKey : undefined;
    try {
        const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            size: 5 * 1024 * 1024,
        });
        const contentType = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
        if (!response.ok || !contentType || !PROVIDER_IMAGE_TYPES.has(contentType)) {
            response.body?.destroy();
        } else {
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 0) {
                if (safeCacheKey) await writeCachedPicture(safeCacheKey, contentType, bytes);
                return { bytes, contentType };
            }
        }
    } catch {
        // Fall through to the local backup.
    }
    return safeCacheKey ? await readCachedPicture(safeCacheKey) : undefined;
}

export async function generateIdenticonPNG(name: string, size: number = 100): Promise<Buffer> {
    return jdenticon.toPng(name, size);
}
