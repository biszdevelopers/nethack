import { z } from "zod";
import { listAssetReferences } from "~~/server/utils/assets";
import { requireUser } from "~~/server/utils/auth";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";

const AssetReferenceListQuery = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(20),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const query = await getValidatedQuery(event, AssetReferenceListQuery.parse);
        const user = await requireUser(event);
        const isAdmin = hasNethackPermission(
            event.context.oauth2?.permissions,
            NethackPermissions.all,
        );

        return await listAssetReferences(event.context.drizzle, user.id, isAdmin, {
            page: query.page,
            pageSize: query.page_size,
        });
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
