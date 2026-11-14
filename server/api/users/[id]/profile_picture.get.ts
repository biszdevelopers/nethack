import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { assetContentType, openStoredAsset } from "~~/server/utils/assets";
import { toPng } from "jdenticon";
import { sendStream } from "h3";
import { Readable } from "stream";
import { UserIdParams } from "~~/shared/schemas";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { id } = await getValidatedRouterParams(event, UserIdParams.parse);

        const user = await getUser(event, Number(id));
        if (!user) {
            throw createError({
                status: 404,
                message: "User not found",
            });
        }
        if (user.profile_picture) {
            const asset = await openStoredAsset("userassets", user.profile_picture);
            setResponseHeader(event, "Content-Type", assetContentType(user.profile_picture));
            setResponseHeader(event, "Content-Length", asset.size);
            setResponseHeader(event, "X-Content-Type-Options", "nosniff");
            setResponseHeader(event, "Cache-Control", "private, max-age=300");
            setResponseHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");
            return sendStream(event, asset.stream);
        }
        const png = toPng(user.email.toString(), 200);
        setResponseHeader(event, "Content-Type", "image/png");
        setResponseHeader(event, "X-Content-Type-Options", "nosniff");
        setResponseHeader(event, "Cache-Control", "private, max-age=300");
        return Readable.from(png);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
