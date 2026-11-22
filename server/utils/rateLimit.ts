import type { H3Event } from "h3";
import { isIP } from "node:net";

interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}

export interface RateLimitDecision {
    allowed: boolean;
    retryAfter: number;
    resetTime: Date;
}

function parseEnvInt(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/** General API rate limit (requests per minute). */
export const RATE_LIMIT_GENERAL_MAX = parseEnvInt("RATE_LIMIT_GENERAL_MAX", 1200);
export const RATE_LIMIT_WINDOW_MS = parseEnvInt("RATE_LIMIT_WINDOW_MS", 60 * 1000);

/** Authentication/login rate limit (attempts per minute). */
export const RATE_LIMIT_AUTH_MAX = parseEnvInt("RATE_LIMIT_AUTH_MAX", 200);

/** Voting/scoring rate limit (submissions per minute). */
export const RATE_LIMIT_VOTE_MAX = parseEnvInt("RATE_LIMIT_VOTE_MAX", 300);

/** File upload rate limit (uploads per minute). */
export const RATE_LIMIT_UPLOAD_MAX = parseEnvInt("RATE_LIMIT_UPLOAD_MAX", 100);

/** Cheap process-wide request gate that runs before any body buffering. */
export const RATE_LIMIT_REQUEST_GATE_MAX = parseEnvInt("RATE_LIMIT_REQUEST_GATE_MAX", 6000);

/** basis-auth backchannel limit; high enough that revocation storms are never dropped. */
export const RATE_LIMIT_BACKCHANNEL_MAX = parseEnvInt("RATE_LIMIT_BACKCHANNEL_MAX", 600);

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

/** Backchannel receivers are server-to-server; keep revocations well below the limit. */
export const BACKCHANNEL_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_BACKCHANNEL_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    keyPrefix: "backchannel",
};

export const REQUEST_GATE_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: RATE_LIMIT_REQUEST_GATE_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    keyPrefix: "gate",
};

interface Bucket {
    count: number;
    resetAt: number;
}

// Fixed-window counters keep get/set O(1). Map insertion order doubles as the
// LRU list: touching a key deletes and re-inserts it, so the head is coldest.
const buckets = new Map<string, Bucket>();

const MAX_TRACKED_KEYS = 10000;
const EVICT_DOWN_TO_KEYS = 9000;

/** Clear the rate limit state — exposed for testing. */
export function clearRateLimitHistory() {
    buckets.clear();
}

/** Number of tracked identifiers — exposed for testing the bounded map. */
export function getTrackedRateLimitKeys(): number {
    return buckets.size;
}

function enforceCapacity() {
    if (buckets.size <= MAX_TRACKED_KEYS) return;
    while (buckets.size > EVICT_DOWN_TO_KEYS) {
        const oldest = buckets.keys().next();
        if (oldest.done) return;
        buckets.delete(oldest.value);
    }
}

/** Consume one request from a key's fixed window without touching the event. */
export function consumeRateLimit(
    identifier: string,
    config: Pick<RateLimitConfig, "maxRequests" | "windowMs">,
    now = Date.now(),
): RateLimitDecision {
    const maxRequests = config.maxRequests;
    if (maxRequests <= 0) {
        return {
            allowed: false,
            retryAfter: Math.ceil(config.windowMs / 1000),
            resetTime: new Date(now + config.windowMs),
        };
    }

    let bucket = buckets.get(identifier);
    if (bucket && now < bucket.resetAt) {
        buckets.delete(identifier);
    } else {
        bucket = { count: 0, resetAt: now + config.windowMs };
    }
    bucket.count += 1;
    buckets.set(identifier, bucket);
    enforceCapacity();

    const allowed = bucket.count <= maxRequests;
    return {
        allowed,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        resetTime: new Date(bucket.resetAt),
    };
}

/** Number of trusted reverse proxies configured by the operator. */
export function getTrustedProxyHops(): number {
    const configured = process.env.TRUSTED_PROXY_HOPS;
    if (!configured || !/^\d+$/.test(configured)) return 0;
    const hops = Number(configured);
    return hops >= 0 && hops <= 10 ? hops : 0;
}

/** Resolve the caller address, walking X-Forwarded-For only for trusted proxies. */
export function getClientIp(event: H3Event): string {
    const request = event.node?.req;
    const socketAddress = request?.socket?.remoteAddress;
    let ip = socketAddress || "unknown";
    const trustedProxyHops = getTrustedProxyHops();

    if (socketAddress && trustedProxyHops > 0) {
        const forwarded = readHeader(event, "x-forwarded-for");
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

    return ip;
}

function readHeader(event: H3Event, name: string): string | undefined {
    const header = typeof getHeader === "function" ? getHeader(event, name) : undefined;
    return typeof header === "string" ? header : undefined;
}

interface SessionContext {
    authUserId?: number | null;
}

/** Session user id if the limiter already resolved it for this request. */
export function getCachedSessionUserId(event: H3Event): number | undefined {
    const context = event.context as SessionContext | undefined;
    return typeof context?.authUserId === "number" ? context.authUserId : undefined;
}

let basisAuthSessionModule: typeof import("~~/server/utils/basis-auth-session") | undefined;

async function loadSessionUserId(event: H3Event): Promise<number | undefined> {
    const context = event.context as SessionContext | undefined;
    if (context && context.authUserId !== undefined) return context.authUserId ?? undefined;

    let userId: number | undefined;
    try {
        const module =
            basisAuthSessionModule ?? (await import("~~/server/utils/basis-auth-session"));
        basisAuthSessionModule = module;
        const session = module.readBasisAuthUserSession(event);
        const parsed = Number(session?.userId);
        if (Number.isSafeInteger(parsed) && parsed > 0) userId = parsed;
    } catch {
        userId = undefined;
    }

    if (context) context.authUserId = userId ?? null;
    return userId;
}

/** Stable, IPv4/IPv6-agnostic identifier for one caller. */
export async function getClientIdentifier(event: H3Event): Promise<string> {
    const userId = await loadSessionUserId(event);
    if (userId) return `user:${userId}`;

    // An Authorization header is caller-controlled until a route verifies it.
    // Keying the limiter by an unverified token lets a caller rotate arbitrary
    // values to reset its bucket, so unverified API clients share their IP
    // bucket. Routes still identify the validated token for authorization.
    return `ip:${getClientIp(event)}`;
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

        const decision = consumeRateLimit(identifier, finalConfig);
        if (!decision.allowed) {
            setHeader(event, "Retry-After", decision.retryAfter);
            throw createError({
                status: 429,
                statusMessage: "Too Many Requests",
                data: {
                    message: `Rate limit exceeded. Max ${finalConfig.maxRequests} requests per ${finalConfig.windowMs / 1000}s.`,
                    retryAfter: decision.retryAfter,
                    resetTime: decision.resetTime.toISOString(),
                },
            });
        }

        return await handler(event);
    };
}
