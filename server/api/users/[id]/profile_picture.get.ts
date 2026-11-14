import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { assetContentType, openStoredAsset } from "~~/server/utils/assets";
import { toPng } from "jdenticon";
import { sendStream } from "h3";
import { Readable } from "stream";
import { UserIdParams } from "~~/shared/schemas";
import { fetchBasisAuthPicture, getBasisAuthPictureUrl } from "~~/server/utils/profile";

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
        setResponseHeader(event, "X-Content-Type-Options", "nosniff");
        setResponseHeader(event, "Cache-Control", "private, max-age=300");
        setResponseHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");

        const providerUrl = getBasisAuthPictureUrl(
            user.profile_picture,
            process.env.BASIS_AUTH_ISSUER,
        );
        if (providerUrl) {
            const picture = await fetchBasisAuthPicture(providerUrl);
            if (picture) {
                setResponseHeader(event, "Content-Type", picture.contentType);
                setResponseHeader(event, "Content-Length", picture.bytes.length);
                return picture.bytes;
            }
        } else if (user.profile_picture && !URL.parse(user.profile_picture)) {
            const asset = await openStoredAsset("userassets", user.profile_picture);
            setResponseHeader(event, "Content-Type", assetContentType(user.profile_picture));
            setResponseHeader(event, "Content-Length", asset.size);
            return sendStream(event, asset.stream);
        }
        const png = toPng(user.email.toString(), 200);
        setResponseHeader(event, "Content-Type", "image/png");
        return Readable.from(png);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
