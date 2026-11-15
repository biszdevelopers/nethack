import { sendStream } from "h3";
import type { AssetCollection } from "~~/server/utils/assets";
import { assetContentType, isInlineSafeAsset, openStoredAsset } from "~~/server/utils/assets";
import type { H3Event } from "h3";

export interface PublicStoredAssetOptions {
    collection: AssetCollection;
    cacheControl: string;
    pathPrefix?: string;
}

export async function sendPublicStoredAsset(
    event: H3Event,
    requestedPath: string | undefined,
    options: PublicStoredAssetOptions,
) {
    if (!requestedPath) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }
    if (requestedPath.split("/").some((segment) => segment.startsWith("."))) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }

    let asset: Awaited<ReturnType<typeof openStoredAsset>>;
    try {
        asset = await openStoredAsset(
            options.collection,
            `${options.pathPrefix ?? ""}${requestedPath}`,
        );
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ELOOP") {
            throw createError({ statusCode: 404, statusMessage: "Asset not found" });
        }
        throw error;
    }

    const name = requestedPath.split("/").at(-1) ?? "download";
    setResponseHeader(event, "Content-Type", assetContentType(name));
    setResponseHeader(event, "Content-Length", asset.size);
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");
    setResponseHeader(event, "Cross-Origin-Resource-Policy", "same-origin");
    setResponseHeader(event, "Cache-Control", options.cacheControl);
    setResponseHeader(
        event,
        "Content-Disposition",
        isInlineSafeAsset(name) ? "inline" : 'attachment; filename="download"',
    );
    return sendStream(event, asset.stream);
}
