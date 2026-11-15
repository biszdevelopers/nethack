import { sendPublicStoredAsset } from "~~/server/utils/public-assets";

export default defineEventHandler(async (event) => {
    return sendPublicStoredAsset(event, getRouterParam(event, "path"), {
        collection: "userassets",
        cacheControl: "public, max-age=300",
    });
});
