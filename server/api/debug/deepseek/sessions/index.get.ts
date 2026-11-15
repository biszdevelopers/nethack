import { getAllSessions } from "~~/server/utils/deepseek-store";
import { requireUser } from "~~/server/utils/auth";
import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Debug.deepseekRead);

        return getAllSessions(user.id);
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
