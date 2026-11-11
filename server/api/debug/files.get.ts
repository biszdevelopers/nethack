import { getStoredAssetNames } from "~~/server/utils/assets";
import { requireUser } from "~~/server/utils/auth";
import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Debug.filesRead);

        return {
            assets: await getStoredAssetNames("assets", "uploads"),
            userast: await getStoredAssetNames("userassets"),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
