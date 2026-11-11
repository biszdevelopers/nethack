import { sendStream } from "h3";
import { assetContentType, isInlineSafeAsset, openStoredAsset } from "~~/server/utils/assets";

export default defineEventHandler(async (event) => {
    const requestedPath = getRouterParam(event, "path");
    if (!requestedPath) {
        throw createError({ statusCode: 404, statusMessage: "Asset not found" });
    }

    let asset: Awaited<ReturnType<typeof openStoredAsset>>;
    try {
        asset = await openStoredAsset("userassets", requestedPath);
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
    setResponseHeader(event, "Cache-Control", "public, max-age=300");
    setResponseHeader(
        event,
        "Content-Disposition",
        isInlineSafeAsset(name) ? "inline" : 'attachment; filename="download"',
    );
    return sendStream(event, asset.stream);
});
