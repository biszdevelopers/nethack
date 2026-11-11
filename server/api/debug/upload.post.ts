import { storeMultipartAsset } from "~~/server/utils/multipart-upload";
import { enforceSameOriginCookieRequest } from "~~/server/utils/request-security";
import { NethackPermissions } from "~~/shared/permissions";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit, UPLOAD_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const query = getQuery(event);
        const mode = query.mode;
        if (mode !== "static" && mode !== "user") {
            throw createError({ statusCode: 400, message: "Invalid mode" });
        }

        enforceSameOriginCookieRequest(event);
        await requireUser(event, NethackPermissions.Debug.filesWrite);

        const contentType = getHeader(event, "content-type");
        const { filename, relativePath } = await storeMultipartAsset(
            event.node.req,
            contentType,
            mode === "static" ? "assets" : "userassets",
        );

        return {
            permalink: mode === "static" ? `/assets/${relativePath}` : `/userast/${filename}`,
        };
    }, UPLOAD_RATE_LIMIT_CONFIG),
);
