import z from "zod";
import { storeMultipartAsset } from "~~/server/utils/multipart-upload";
import { enforceSameOriginCookieRequest } from "~~/server/utils/request-security";
import { NethackPermissions } from "~~/shared/permissions";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit, UPLOAD_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const DebugUploadQuery = z.object({ mode: z.enum(["static", "user"]) });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { mode } = await getValidatedQuery(event, DebugUploadQuery.parse);

        enforceSameOriginCookieRequest(event);
        const user = await requireUser(event, NethackPermissions.Debug.filesWrite);

        const contentType = getHeader(event, "content-type");
        const { filename, relativePath, referenceId } = await storeMultipartAsset(
            event.node.req,
            contentType,
            mode === "static" ? "assets" : "userassets",
            { database: event.context.drizzle, createdBy: user.id },
        );
        if (!referenceId) {
            throw createError({
                statusCode: 500,
                statusMessage: "Unable to register asset reference",
            });
        }

        return {
            permalink: mode === "static" ? `/assets/${relativePath}` : `/userast/${filename}`,
            referenceId,
        };
    }, UPLOAD_RATE_LIMIT_CONFIG),
);
