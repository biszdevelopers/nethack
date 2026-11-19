import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

const DEFAULT_PICTURE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

async function readCachedPicture(cacheKey: string, maxAgeMs = Infinity) {
    const now = Date.now();
    for (const [contentType, extension] of Object.entries(extensionByType)) {
        try {
            const path = cachePath(cacheKey, extension);
            const bytes = await readFile(path);
            if (bytes.length === 0) continue;
            if (maxAgeMs !== Infinity) {
                const { mtimeMs } = await stat(path);
                if (now - mtimeMs > maxAgeMs) continue;
            }
            return { bytes, contentType };
        } catch {
            // Try the next cached extension.
        }
    }
    return undefined;
}

async function writeCachedPicture(cacheKey: string, contentType: string, bytes: Buffer) {
    // Callers reject types outside PROVIDER_IMAGE_TYPES, so the extension always exists.
    const extension = extensionByType[contentType]!;
    const path = cachePath(cacheKey, extension);
    // A PID-only temp name collides when two requests cache the same picture
    // concurrently; the UUID keeps each write (and its cleanup) independent.
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, path);
        for (const other of new Set(Object.values(extensionByType))) {
            if (other !== extension) {
                await rm(cachePath(cacheKey, other), { force: true });
            }
        }
    } catch {
        // The provider remains authoritative; a cache failure must not break the response.
    } finally {
        await rm(temporary, { force: true });
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

export async function fetchBasisAuthPicture(
    url: string,
    cacheKey?: string,
    options: { maxAgeMs?: number; forceRefresh?: boolean } = {},
) {
    const safeCacheKey = cacheKey && /^\d+$/.test(cacheKey) ? cacheKey : undefined;
    // Serve a recently cached avatar without contacting the identity provider.
    // This keeps an unauthenticated avatar route from amplifying IdP traffic.
    if (safeCacheKey && !options.forceRefresh) {
        const cached = await readCachedPicture(
            safeCacheKey,
            options.maxAgeMs ?? DEFAULT_PICTURE_CACHE_MAX_AGE_MS,
        );
        if (cached) return cached;
    }
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
            (response.body as unknown as { destroy?: () => void } | null)?.destroy?.();
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
