import { z } from "zod";
import { releaseAssetReference } from "~~/server/utils/assets";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit } from "~~/server/utils/rateLimit";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";

const AssetReferenceParams = z.object({ referenceId: z.string().uuid() });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const { referenceId } = await getValidatedRouterParams(event, AssetReferenceParams.parse);
        const user = await requireUser(event);
        const isAdmin = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.all,
        );
        const released = await releaseAssetReference(
            event.context.drizzle,
            referenceId,
            user.id,
            isAdmin,
        );
        if (!released) {
            // Use the same response for missing and non-owned IDs to avoid reference enumeration.
            throw createError({ statusCode: 404, statusMessage: "Asset reference not found" });
        }
        return { message: "Asset permalink released" };
    }),
);
