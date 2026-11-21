import {
    consumeRateLimit,
    getClientIp,
    REQUEST_GATE_RATE_LIMIT_CONFIG,
} from "~~/server/utils/rateLimit";

const EXEMPT_PATHS = new Set(["/api/auth/basis/backchannel"]);

/**
 * Cheap per-IP gate that runs before any body is buffered. Route-level limits
 * stay in place; this only exists to shed floods early.
 */
export default defineEventHandler((event) => {
    const pathname = event.path.split("?")[0]!;
    if (!pathname.startsWith("/api/")) return;
    if (pathname === "/api/health" || pathname.startsWith("/api/health/")) return;
    if (EXEMPT_PATHS.has(pathname)) return;

    const decision = consumeRateLimit(
        `gate:ip:${getClientIp(event)}`,
        REQUEST_GATE_RATE_LIMIT_CONFIG,
    );
    if (decision.allowed) return;

    setHeader(event, "Retry-After", decision.retryAfter);
    throw createError({
        status: 429,
        statusMessage: "Too Many Requests",
        data: {
            message: "Request rate exceeded",
            retryAfter: decision.retryAfter,
            resetTime: decision.resetTime.toISOString(),
        },
    });
});
