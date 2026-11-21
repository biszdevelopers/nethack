import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

/**
 * Microsoft Graph lifecycle webhooks were removed together with the Graph
 * integration. Keep the public path closed so a stale subscription cannot
 * reach a handler.
 */
export default defineEventHandler(
    applyRateLimit(async () => {
        throw createError({ statusCode: 404, message: "Not found" });
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
