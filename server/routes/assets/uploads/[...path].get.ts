import { sendPublicStoredAsset } from "~~/server/utils/public-assets";

export default defineEventHandler(async (event) => {
    return sendPublicStoredAsset(event, getRouterParam(event, "path"), {
        collection: "assets",
        pathPrefix: "uploads/",
        cacheControl: "public, max-age=3600, immutable",
    });
});
