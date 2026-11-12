import type { H3Event } from "h3";
import { isIP } from "node:net";

interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}

function parseEnvInt(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/** General API rate limit (requests per minute). */
export const RATE_LIMIT_GENERAL_MAX = parseEnvInt("RATE_LIMIT_GENERAL_MAX", 120);
export const RATE_LIMIT_WINDOW_MS = parseEnvInt("RATE_LIMIT_WINDOW_MS", 60 * 1000);

/** Authentication/login rate limit (attempts per minute). */
export const RATE_LIMIT_AUTH_MAX = parseEnvInt("RATE_LIMIT_AUTH_MAX", 20);

/** Voting/scoring rate limit (submissions per minute). */
export const RATE_LIMIT_VOTE_MAX = parseEnvInt("RATE_LIMIT_VOTE_MAX", 30);

/** File upload rate limit (uploads per minute). */
export const RATE_LIMIT_UPLOAD_MAX = parseEnvInt("RATE_LIMIT_UPLOAD_MAX", 10);

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_GENERAL_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
};

/** Per-user judging draft limit; leaves room for the 650 ms client autosave debounce. */
export const JUDGING_DRAFT_RATE_LIMIT_CONFIG: RateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    keyPrefix: "judging-draft",
};

export const AUTH_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_AUTH_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    keyPrefix: "auth",
};

export const VOTE_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_VOTE_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    keyPrefix: "vote",
};

export const UPLOAD_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_UPLOAD_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    keyPrefix: "upload",
};

// Map to store request history: key -> array of timestamps
const requestHistory = new Map<string, number[]>();

// Cap the Map size to prevent unbounded memory growth
const MAX_TRACKED_KEYS = 10000;

// Interval-based cleanup (runs every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = 0;

/** Clear the rate limit history — exposed for testing. */
export function clearRateLimitHistory() {
    requestHistory.clear();
    lastCleanup = 0;
}

function cleanupStaleEntries(now: number) {
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const [key, times] of requestHistory.entries()) {
        const recentTimes = times.filter((t) => t > oneHourAgo);
        if (recentTimes.length === 0) {
            requestHistory.delete(key);
        } else {
            requestHistory.set(key, recentTimes);
        }
    }
}

export async function getClientIdentifier(event: H3Event): Promise<string> {
    try {
        const { readBasisAuthUserSession } = await import("~~/server/utils/basis-auth-session");
        const session = readBasisAuthUserSession(event);
        if (session?.userId) {
            return `user:${session.userId}`;
        }
    } catch {
        // User not authenticated, fall through to IP
    }

    // Fall back to the direct peer unless the operator configured the exact
    // number of trusted reverse proxies. Walk the forwarded chain from the
    // server outward; the selected address is the first untrusted hop.
    const socketAddress = event.node.req.socket?.remoteAddress;
    let ip = socketAddress || "unknown";
    const configuredHops = process.env.TRUSTED_PROXY_HOPS;
    const trustedProxyHops =
        configuredHops && /^\d+$/.test(configuredHops) ? Number(configuredHops) : 0;

    if (socketAddress && trustedProxyHops > 0 && trustedProxyHops <= 10) {
        const forwarded = getHeader(event, "x-forwarded-for");
        const parts = forwarded
            ?.split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const clientIndex = (parts?.length ?? 0) - trustedProxyHops;
        const forwardedClient = clientIndex >= 0 ? parts?.[clientIndex] : undefined;
        if (forwardedClient && parts?.every((address) => isIP(address)) && isIP(forwardedClient)) {
            ip = forwardedClient;
        }
    }

    return `ip:${ip}`;
}

export function applyRateLimit(
    handler: (event: H3Event) => Promise<any>,
    config: Partial<RateLimitConfig> = {},
) {
    const finalConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };

    return async (event: H3Event) => {
        let identifier: string;
        if (finalConfig.keyGenerator) {
            const generated = await finalConfig.keyGenerator(event);
            identifier = generated ?? (await getClientIdentifier(event));
        } else {
            identifier = await getClientIdentifier(event);
        }
        if (finalConfig.keyPrefix) {
            identifier = `${finalConfig.keyPrefix}:${identifier}`;
        }

        const now = Date.now();

        // Run cleanup on a time-based interval instead of probabilistically
        cleanupStaleEntries(now);

        // Treat maxRequests <= 0 as always-limited
        if (finalConfig.maxRequests <= 0) {
            setHeader(event, "Retry-After", Math.ceil(finalConfig.windowMs / 1000));
            throw createError({
                status: 429,
                statusMessage: "Too Many Requests",
                data: {
                    message: `Rate limit exceeded. Max ${finalConfig.maxRequests} requests per ${finalConfig.windowMs / 1000}s.`,
                    retryAfter: Math.ceil(finalConfig.windowMs / 1000),
                },
            });
        }

        // Get or initialize request history for this identifier
        let history = requestHistory.get(identifier) || [];

        // Remove old requests outside the window
        history = history.filter((timestamp) => now - timestamp < finalConfig.windowMs);

        // Check if rate limit exceeded
        if (history.length >= finalConfig.maxRequests) {
            const oldestRequest = history[0]!;
            const resetTime = new Date(oldestRequest + finalConfig.windowMs);
            const retryAfter = Math.ceil((oldestRequest + finalConfig.windowMs - now) / 1000);

            setHeader(event, "Retry-After", retryAfter);

            throw createError({
                status: 429,
                statusMessage: "Too Many Requests",
                data: {
                    message: `Rate limit exceeded. Max ${finalConfig.maxRequests} requests per ${finalConfig.windowMs / 1000}s.`,
                    retryAfter,
                    resetTime: resetTime.toISOString(),
                },
            });
        }

        // Add current request
        history.push(now);
        requestHistory.set(identifier, history);

        // Enforce Map size cap by evicting the oldest entry
        if (requestHistory.size > MAX_TRACKED_KEYS) {
            const firstKey = requestHistory.keys().next().value!;
            requestHistory.delete(firstKey);
        }

        return await handler(event);
    };
}
