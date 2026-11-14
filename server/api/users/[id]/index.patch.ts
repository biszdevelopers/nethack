import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import {
    createUserAssetContentAddressed,
    getUserAssetContentAddress,
    withAssetLifecycleLocks,
} from "~~/server/utils/assets";
import { users } from "~~/server/database/schema";
import { applyRateLimit } from "~~/server/utils/rateLimit";
import { MAX_PROFILE_IMAGE_BYTES, UpdateUserRequest, UserIdParams } from "~~/shared/schemas";
import { clearBasisAuthUserSession } from "~~/server/utils/basis-auth-session";
import { readLimitedRequestBody } from "~~/server/utils/limited-json-body";
import { withProfileUpdateCapacity } from "~~/server/utils/profile-update-capacity";

const MAX_FILE_SIZE = MAX_PROFILE_IMAGE_BYTES;
const MAX_PROFILE_UPDATE_BODY_BYTES = 10 * 1024 * 1024;
const CONTENT_ADDRESSED_PROFILE_ASSET = /^profiles\/[a-f0-9]{64}\.(?:gif|jpg|png|webp)$/;

function getManagedProfileAssetPath(value: string | null | undefined): string | null {
    if (!value) return null;
    const path = value.startsWith("url|") ? value.slice(4) : value;
    return CONTENT_ADDRESSED_PROFILE_ASSET.test(path) ? path : null;
}

function decodedBase64Length(encoded: string): number | null {
    if (!encoded.length || encoded.length % 4 !== 0) return null;
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const contentLength = encoded.length - padding;

    for (let index = 0; index < contentLength; index += 1) {
        const code = encoded.charCodeAt(index);
        const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        const isDigit = code >= 48 && code <= 57;
        if (!isLetter && !isDigit && code !== 43 && code !== 47) return null;
    }

    const finalValue = base64Value(encoded.charCodeAt(contentLength - 1));
    if (padding === 2 && finalValue % 16 !== 0) return null;
    if (padding === 1 && finalValue % 4 !== 0) return null;
    return (encoded.length / 4) * 3 - padding;
}

function base64Value(code: number): number {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 43) return 62;
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
        String.fromCharCode(code),
    );
}

function decodeValidatedImage(
    dataUrl: string,
    label: "Profile theme" | "Avatar",
): { data: Buffer; extension: string } {
    const separator = dataUrl.indexOf(",");
    if (separator < 0) {
        throw createError({
            status: 400,
            message: "Invalid image data format. Expected a base64 data URL.",
        });
    }

    const header = dataUrl.slice(0, separator);
    const encoded = dataUrl.slice(separator + 1);
    const mime = /^data:([^;,]+);base64$/i.exec(header)?.[1]?.toLowerCase();
    if (!mime) {
        throw createError({
            status: 400,
            message: "Could not determine image type from upload data.",
        });
    }

    const extensionByMime: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
    };
    const extension = extensionByMime[mime];
    if (!extension) {
        throw createError({
            status: 400,
            message: `Invalid image type for ${label.toLowerCase()}. Only JPEG, PNG, GIF, and WebP are allowed.`,
        });
    }

    if (encoded.length > Math.ceil(MAX_FILE_SIZE / 3) * 4) {
        throw createError({
            statusCode: 413,
            message: `${label} image is too large. Maximum size is 7MB.`,
        });
    }
    const decodedLength = decodedBase64Length(encoded);
    if (decodedLength === null) {
        throw createError({ status: 400, message: "Invalid base64 image data." });
    }
    if (decodedLength > MAX_FILE_SIZE) {
        throw createError({
            statusCode: 413,
            message: `${label} image is too large. Maximum size is 7MB.`,
        });
    }

    const data = Buffer.from(encoded, "base64");
    const hasValidSignature =
        mime === "image/jpeg" || mime === "image/jpg"
            ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
            : mime === "image/png"
              ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : mime === "image/gif"
                ? ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))
                : data.subarray(0, 4).toString("ascii") === "RIFF" &&
                  data.subarray(8, 12).toString("ascii") === "WEBP";
    if (!hasValidSignature) {
        throw createError({
            statusCode: 400,
            message: "Image content does not match its file type.",
        });
    }
    return { data, extension };
}

export default defineEventHandler(
    applyRateLimit(
        async (event) => {
            const { id } = await getValidatedRouterParams(event, UserIdParams.parse);
            const { id: userID } = await requireUser(event, NethackPermissions.Profile.updateSelf);

            if (id !== userID) {
                throw createError({ status: 403, message: "Cannot update other users" });
            }

            return await withProfileUpdateCapacity(event, async () => {
                event._requestBody = (await readLimitedRequestBody(
                    event,
                    MAX_PROFILE_UPDATE_BODY_BYTES,
                )) as unknown as BodyInit;
                const { name, profile_theme_image, avatar } = await readValidatedBody(
                    event,
                    UpdateUserRequest.parse,
                );
                const user = await getUser(event, id);
                if (!user) {
                    clearBasisAuthUserSession(event);
                    throw createError({ status: 401, message: "Logged in user not found" });
                }

                // Decode and validate every uploaded image before any write so a bad
                // second field cannot leave a partially updated profile.
                const themeImage =
                    profile_theme_image !== undefined && profile_theme_image !== null
                        ? decodeValidatedImage(profile_theme_image.toString(), "Profile theme")
                        : null;
                const avatarImage =
                    avatar !== undefined && avatar !== null
                        ? decodeValidatedImage(avatar.toString(), "Avatar")
                        : null;

                const lockPaths = [
                    ...(profile_theme_image !== undefined
                        ? [getManagedProfileAssetPath(user.profile_theme)]
                        : []),
                    ...(avatar !== undefined
                        ? [getManagedProfileAssetPath(user.profile_picture)]
                        : []),
                    ...(themeImage
                        ? [getUserAssetContentAddress(themeImage.data, themeImage.extension)]
                        : []),
                    ...(avatarImage
                        ? [getUserAssetContentAddress(avatarImage.data, avatarImage.extension)]
                        : []),
                ].filter((path): path is string => path !== null);
                const uniqueLockPaths = [...new Set(lockPaths)];

                const updates: Partial<typeof users.$inferInsert> = {};
                if (name !== undefined) updates.name = name;
                if (profile_theme_image !== undefined) {
                    updates.profile_theme = themeImage
                        ? `url|${getUserAssetContentAddress(themeImage.data, themeImage.extension)}`
                        : null;
                }
                if (avatar !== undefined) {
                    updates.profile_picture = avatarImage
                        ? getUserAssetContentAddress(avatarImage.data, avatarImage.extension)
                        : null;
                }

                if (Object.keys(updates).length > 0) {
                    await withAssetLifecycleLocks(
                        event.context.drizzle,
                        uniqueLockPaths,
                        async (tx) => {
                            if (themeImage) {
                                const publishedPath = await createUserAssetContentAddressed(
                                    themeImage.data,
                                    themeImage.extension,
                                );
                                if (publishedPath !== updates.profile_theme?.slice(4)) {
                                    throw new Error(
                                        "Published profile theme path does not match its digest",
                                    );
                                }
                            }
                            if (avatarImage) {
                                const publishedPath = await createUserAssetContentAddressed(
                                    avatarImage.data,
                                    avatarImage.extension,
                                );
                                if (publishedPath !== updates.profile_picture) {
                                    throw new Error(
                                        "Published avatar path does not match its digest",
                                    );
                                }
                            }

                            const changed = await tx
                                .update(users)
                                .set(updates)
                                .where(eq(users.id, id))
                                .returning({ id: users.id });
                            if (changed.length === 0) {
                                throw createError({ status: 404, message: "User not found" });
                            }
                        },
                    );
                }

                return { message: "Your profile is updated" };
            });
        },
        { maxRequests: 10, windowMs: 60 * 1000 },
    ),
);
