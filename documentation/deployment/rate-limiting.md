---
title: Rate Limiting
description: Fixed-window, in-memory rate limiting for API endpoint protection
---

# Rate Limiting

All API endpoints are protected by an in-memory fixed-window rate limiter that bounds how many requests a client can make in a window.

::: info Source `server/utils/rateLimit.ts`, `server/middleware/00.request-rate-gate.ts` :::

## Tiers

| Tier | Env Variable | Default Limit | Routes Protected |
| --- | --- | :-: | --- |
| **Request gate** | `RATE_LIMIT_REQUEST_GATE_MAX` | 6000/min per IP | Every `/api/*` request, before any body is buffered |
| **General** | `RATE_LIMIT_GENERAL_MAX` | 1200/min | All non-sensitive API routes |
| **Judging drafts** | `RATE_LIMIT_GENERAL_MAX` | 1200/min per judge | `GET`, `PUT`, and `DELETE /api/judging/drafts/:teamId` |
| **Authentication** | `RATE_LIMIT_AUTH_MAX` | 200/min | `/api/login`, `/api/auth/basis/callback` |
| **Vote / score** | `RATE_LIMIT_VOTE_MAX` | 300/min | `/api/ballot`, `/api/teams/:id/scores` |
| **File upload** | `RATE_LIMIT_UPLOAD_MAX` | 100/min | Upload routes |
| **Backchannel** | `RATE_LIMIT_BACKCHANNEL_MAX` | 600/min | `POST /api/auth/basis/backchannel` |

All tiers share `RATE_LIMIT_WINDOW_MS` (default `60000`). The request gate skips `/api/health*` and the backchannel receiver, so health probes and revocation storms are never dropped by the general gate. Route-level limits stay in place; the gate only sheds floods before the server buffers a body.

Judging draft routes use the general limit with a dedicated bucket, leaving room for the judge editor's 650 ms autosave debounce.

## Environment Variables

| Variable                      | Default | Purpose                                    |
| ----------------------------- | ------- | ------------------------------------------ |
| `RATE_LIMIT_GENERAL_MAX`      | `1200`  | General API requests per window            |
| `RATE_LIMIT_AUTH_MAX`         | `200`   | Authentication attempts per window         |
| `RATE_LIMIT_VOTE_MAX`         | `300`   | Voting/scoring submissions per window      |
| `RATE_LIMIT_UPLOAD_MAX`       | `100`   | Uploads per window                         |
| `RATE_LIMIT_REQUEST_GATE_MAX` | `6000`  | Pre-body per-IP requests per window        |
| `RATE_LIMIT_BACKCHANNEL_MAX`  | `600`   | basis-auth backchannel requests per window |
| `RATE_LIMIT_WINDOW_MS`        | `60000` | Window length in milliseconds              |
| `TRUSTED_PROXY_HOPS`          | `0`     | Exact trusted proxy count (0–10)           |

The values are read when the module loads. A missing or non-numeric value falls back to the default.

::: tip Keep `TRUSTED_PROXY_HOPS=0` when clients connect directly. Behind a proxy, set the exact number of trusted hops only after configuring every proxy to append the actual peer to `X-Forwarded-For`. Invalid or incomplete chains fall back to the socket peer. :::

## Configuration Interface

```ts
interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    keyGenerator?: (event: H3Event) => Promise<string | null> | string | null;
}
```

- `maxRequests`: requests allowed in the window
- `windowMs`: window length in milliseconds
- `keyPrefix`: added to the generated client identifier
- `keyGenerator`: optional custom identifier; returning `null` uses the default

## Usage

### `applyRateLimit(handler, config?)`

```ts
import { applyRateLimit } from "~~/server/utils/rateLimit";

export default applyRateLimit(
    async (event) => {
        // handler
    },
    {
        maxRequests: 30,
        windowMs: 60 * 1000,
    },
);
```

If `config` is omitted, the general configuration (1200 req/min) is used.

### `consumeRateLimit(identifier, config, now?)`

Consumes one request without touching an H3 event. It returns `{ allowed, retryAfter, resetTime }`. The pre-body gate uses this directly.

## Client Identification

The wrapper resolves the caller in this order:

1. **Session user** — `user:{id}` when the session is already resolved or can be read.
2. **Bearer token** — `bearer:{sha256-prefix}` for explicit `Authorization: Bearer` requests. The token is hashed, not verified, so this stays cheap and stable per token.
3. **IP address** — `ip:{ip}` when neither identity is available.

An optional `keyPrefix` is prepended, so each tier keeps separate counters for the same caller.

### Address resolution

`getClientIp(event)` starts from `event.node.req.socket.remoteAddress`. When `TRUSTED_PROXY_HOPS` is greater than zero, it reads `X-Forwarded-For`, requires every entry to be a valid IP, and selects the entry that many positions from the right. Anything malformed falls back to the socket peer. `X-Real-IP` is never trusted.

#### Rate limit response

Exceeding a limit returns **429 Too Many Requests**:

```json
{
    "status": 429,
    "code": "rate_limited",
    "error": "rate_limited",
    "error_description": "Rate limit exceeded. Max 1200 requests per 60s."
}
```

The response also sets `Retry-After` in seconds.

## Memory Model

Counters use a `Map<string, { count, resetAt }>`:

- A request reads and increments one bucket: O(1) time.
- When the window has elapsed, the bucket restarts at the current time. There is no per-request timestamp array and no periodic sweep.
- Map insertion order doubles as an LRU list: touching a key deletes and re-inserts it, so the coldest key is at the head.
- The map is capped at **10,000 keys**. When exceeded, the oldest keys are evicted until 9,000 remain.

`clearRateLimitHistory()` and `getTrackedRateLimitKeys()` are exported for tests.

## Limitations

### Per-instance isolation

::: warning Per process The limiter is in-memory and per-process. A client can spend the full limit against each server process in the same window. The effective limit is per process, not global. For global limits, use a shared store such as Redis. :::

### No persistent state

Counters reset on restart and are not shared across deployments or instances.

### Proxy trust

Forwarded client addresses are part of the security boundary. Configure exactly the number of proxies you operate, and do not accept forwarded headers from untrusted hops.
