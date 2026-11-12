---
title: Rate Limiting
description: In-memory rate limiting for API endpoint protection
---

# Rate Limiting

All API endpoints are protected by an in-memory rate limiter that prevents abuse by limiting the number of requests a client can make within a time window.

::: info Source `server/utils/rateLimit.ts` :::

## Default Configuration

The rate limiter defines **5 independent tiers**, each with its own request counter per client:

| Tier | Env Variable | Default Limit | Routes Protected |
| --- | --- | :-: | --- |
| **General** | `RATE_LIMIT_GENERAL_MAX` | 120/min | All non-sensitive API routes |
| **Authentication** | `RATE_LIMIT_AUTH_MAX` | 20/min | `/api/login`, `/api/auth/basis/callback` |
| **Vote / Score** | `RATE_LIMIT_VOTE_MAX` | 30/min | `/api/ballot`, `/api/teams/:id/scores` |
| **Judging drafts** | `RATE_LIMIT_GENERAL_MAX` | 120/min | `GET`, `PUT`, and `DELETE /api/judging/drafts/:teamId` |
| **File Upload** | `RATE_LIMIT_UPLOAD_MAX` | 10/min | Upload routes |

All tiers share the same window duration, configurable via `RATE_LIMIT_WINDOW_MS` (default: `60000` ms / 1 minute). Judging draft routes use the general limit with a dedicated per-user bucket, leaving room for the judge editor's 650 ms autosave debounce without sharing capacity with other general API requests.

```ts
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
    maxRequests: 120, // overridden by RATE_LIMIT_GENERAL_MAX
    windowMs: 60 * 1000, // overridden by RATE_LIMIT_WINDOW_MS
};
```

## Environment Variables

The following environment variables override the default limits:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RATE_LIMIT_GENERAL_MAX` | `120` | General API rate limit, requests per window |
| `RATE_LIMIT_AUTH_MAX` | `20` | Authentication endpoint rate limit, attempts per window |
| `RATE_LIMIT_VOTE_MAX` | `30` | Voting/scoring endpoint rate limit, submissions per window |
| `RATE_LIMIT_UPLOAD_MAX` | `10` | File upload endpoint rate limit, uploads per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `TRUSTED_PROXY_HOPS` | `0` | Exact trusted proxy count (0–10); requires proxies to append the actual peer to `X-Forwarded-For` |

These values are read at process startup via `parseEnvInt()` in `server/utils/rateLimit.ts`. If an environment variable is unset or contains a non-numeric value, the default is used instead.

::: tip Keep `TRUSTED_PROXY_HOPS=0` when users connect directly. Behind a proxy, set the exact number of trusted hops only after configuring every proxy to append the actual peer address to `X-Forwarded-For`. Invalid or incomplete chains fall back to the socket peer. :::

## Configuration Interface

```ts
interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}
```

- `maxRequests`: Maximum number of requests allowed within the window
- `windowMs`: Time window in milliseconds
- `keyPrefix`: Optional prefix added to the generated client identifier
- `keyGenerator`: Optional custom function that returns a client identifier; if it returns `null`, the default identifier is used

## Usage

### `applyRateLimit(handler, config?)`

Wraps an API handler with rate limiting:

```ts
import { applyRateLimit } from "~/server/utils/rateLimit";

export default applyRateLimit(
    async (event) => {
        // Your handler logic
    },
    {
        maxRequests: 30, // Optional: override default
        windowMs: 60 * 1000, // Optional: override default
    },
);
```

If `config` is omitted, the default configuration (120 req/min) is used.

## Client Identification

The rate limiter identifies clients using a two-tier strategy:

### 1. Authenticated Users

If the request has a valid session, the user ID is used:

```
user:{id}
```

This means each authenticated user has their own rate limit bucket, regardless of IP address.

### 2. Unauthenticated Requests

If no session is found, the request is identified by IP address:

```
ip:{ip}
```

The IP address is resolved from the direct socket peer unless an exact proxy hop count is configured. When enabled, the limiter selects the first untrusted address walking back from the app through the proxy chain and accepts it only if it is a valid IP address.

| Priority | Source | Notes |
| :-: | --- | --- |
| 1 | Configured `X-Forwarded-For` chain | Used only when the socket peer exists, the chain includes the configured number of hops, and the selected item is a valid IP |
| 2 | Direct socket peer address | Fallback when proxy trust is disabled or the forwarded chain is invalid |
| 3 | `unknown` | Fallback when no socket address is available |

```ts
const socketAddress = event.node.req.socket?.remoteAddress;
const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
const forwarded = getHeader(event, "x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim());
const selected = forwarded?.[forwarded.length - trustedHops];
const ip = trustedHops > 0 && isIP(selected) ? selected : socketAddress || "unknown";

return `ip:${ip}`;
```

::: tip The proxy chain is part of the rate-limit security boundary. Never trust forwarded headers from untrusted proxy hops. :::

## Rate Limit Response

When the rate limit is exceeded, the handler throws a **429 Too Many Requests** error:

```json
{
    "statusCode": 429,
    "statusMessage": "Too Many Requests",
    "data": {
        "message": "Rate limit exceeded. Max 120 requests per 60s.",
        "retryAfter": 42,
        "resetTime": "2026-06-03T14:30:00.000Z"
    }
}
```

### Response Headers

| Header | Value | Description |
| --- | --- | --- |
| `Retry-After` | Seconds until the rate limit resets | Standard HTTP header indicating when the client can retry |

The `Retry-After` value is calculated as:

```ts
const retryAfter = Math.ceil((oldestRequest + finalConfig.windowMs - now) / 1000);
```

## Memory Management

### Request History Storage

Request timestamps are stored in an in-memory `Map`:

```ts
const requestHistory = new Map<string, number[]>();
```

Each key (client identifier) maps to an array of request timestamps within the current window.

### Window Cleanup

On every request, timestamps outside the current window are filtered out:

```ts
history = history.filter((timestamp) => now - timestamp < finalConfig.windowMs);
```

### Periodic Full Cleanup

To prevent memory leaks from inactive clients, a full cleanup runs at most once every 5 minutes:

```ts
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// ...
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
```

This removes entries with no requests in the last hour.

### Map Size Cap

To prevent unbounded growth under high traffic or attack, the `Map` is capped at **10,000 keys**. When the cap is exceeded, the oldest entry is evicted:

```ts
const MAX_TRACKED_KEYS = 10000;
// ...
if (requestHistory.size > MAX_TRACKED_KEYS) {
    const firstKey = requestHistory.keys().next().value;
    if (firstKey !== undefined) {
        requestHistory.delete(firstKey);
    }
}
```

## Limitations

### Per-Instance Isolation

::: warning Single Process Rate limiting is **in-memory and per-process**. Each server process maintains its own `requestHistory` Map. This means:

- A client making 120 requests to process A and 120 requests to process B within the same minute could exceed a shared per-process limit
- The effective rate limit is per-process, not globally distributed
- For global rate limiting, consider using a distributed store (e.g., Redis) :::

### No Persistent State

Since the rate limit state is in-memory:

- It resets when the server restarts
- It does not persist across deployments
- Multiple server instances do not share state

### IP Spoofing

The rate limiter uses the direct socket peer by default. Behind a reverse proxy, set `TRUSTED_PROXY_HOPS` to the exact number of trusted proxies and configure each proxy to append the actual peer address to `X-Forwarded-For`. The limiter selects the first untrusted address from the right side of the chain and falls back to the socket peer when the chain is incomplete or malformed. It never trusts `X-Real-IP`.
