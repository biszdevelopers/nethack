import { defineEventHandler } from "h3";
import { applySecurityHeaders } from "~~/server/utils/security-headers";

/**
 * Applies a baseline set of HTTP security headers to every Nitro response.
 *
 * A single server middleware is used instead of Nuxt routeRules so that API
 * routes, rendered HTML pages, and static assets all receive the same baseline
 * headers without duplication.
 */
export default defineEventHandler((event) => {
    applySecurityHeaders(event);
});
