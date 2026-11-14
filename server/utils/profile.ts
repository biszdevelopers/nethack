import jdenticon from "jdenticon";
import fetch from "node-fetch";

const PROVIDER_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
]);

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

export async function fetchBasisAuthPicture(url: string) {
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
            return undefined;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        return bytes.length > 0 ? { bytes, contentType } : undefined;
    } catch {
        return undefined;
    }
}

export async function generateIdenticonPNG(name: string, size: number = 100): Promise<Buffer> {
    return jdenticon.toPng(name, size);
}
