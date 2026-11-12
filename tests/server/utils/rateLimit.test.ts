import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getClientIdentifier,
    applyRateLimit,
    DEFAULT_RATE_LIMIT_CONFIG,
    clearRateLimitHistory,
    AUTH_RATE_LIMIT_CONFIG,
    JUDGING_DRAFT_RATE_LIMIT_CONFIG,
    VOTE_RATE_LIMIT_CONFIG,
    UPLOAD_RATE_LIMIT_CONFIG,
} from "~~/server/utils/rateLimit";

const readBasisAuthUserSessionMock = vi.hoisted(() => vi.fn());

vi.mock("~~/server/utils/basis-auth-session", () => ({
    readBasisAuthUserSession: readBasisAuthUserSessionMock,
}));

// ---------------------------------------------------------------------------
// Global mocks for Nitro auto-imports
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();
    readBasisAuthUserSessionMock.mockReset();
});

function makeMockEvent(overrides: Record<string, any> = {}) {
    return {
        path: "/api/test",
        method: "GET",
        headers: {} as Record<string, string>,
        context: {},
        node: {
            req: {
                socket: {
                    remoteAddress: "10.0.0.1",
                },
            },
        },
        ...overrides,
    } as any;
}

// ---------------------------------------------------------------------------
// getClientIdentifier
// ---------------------------------------------------------------------------

describe("getClientIdentifier", () => {
    it("returns user-prefixed identifier when session has a user id", async () => {
        readBasisAuthUserSessionMock.mockReturnValue({ userId: 42 });

        const event = makeMockEvent();
        const id = await getClientIdentifier(event);

        expect(id).toBe("user:42");
    });

    it("prefers the direct socket peer address for unauthenticated requests", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.168.1.1" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:192.168.1.1");
    });

    it("ignores x-real-ip when no trusted socket address is available", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-real-ip") return "5.6.7.8";
            return undefined;
        });

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: undefined } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:unknown");
    });

    it('returns "ip:unknown" when no IP source is present', async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: undefined } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:unknown");
    });

    it("ignores x-forwarded-for when no trusted proxy hops are configured", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return "10.0.0.1, 10.0.0.2";
            return undefined;
        });
        delete process.env.TRUSTED_PROXY_HOPS;

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: undefined } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:unknown");
    });

    it("uses the rightmost forwarded address for one configured proxy hop", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return "10.0.0.1, 10.0.0.2, 10.0.0.3";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.0.2.10" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:10.0.0.3");
    });

    it("uses the socket peer when x-forwarded-for is missing", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-real-ip") return "5.6.7.8";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.0.2.10" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:192.0.2.10");
    });

    it("uses the socket peer when x-forwarded-for is malformed", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return ", , ,";
            if (name === "x-real-ip") return "5.6.7.8";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.0.2.10" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:192.0.2.10");
    });

    it("rejects a forwarded chain containing an invalid address", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return "spoofed, 10.0.0.2";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.0.2.10" } } },
        });
        expect(await getClientIdentifier(event)).toBe("ip:192.0.2.10");
    });

    it("rotation of x-forwarded-for does not bypass the limiter", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        let forwarded = "10.0.0.1, 10.0.0.2";
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return forwarded;
            return undefined;
        });
        delete process.env.TRUSTED_PROXY_HOPS;

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.168.1.1" } } },
        });

        const id1 = await getClientIdentifier(event);
        forwarded = "10.0.0.2, 10.0.0.1";
        const id2 = await getClientIdentifier(event);

        expect(id1).toBe("ip:192.168.1.1");
        expect(id2).toBe("ip:192.168.1.1");
        expect(id1).toBe(id2);
    });

    it("falls back to IP when getUserSession throws an error", async () => {
        (globalThis as any).getUserSession = vi.fn().mockRejectedValue(new Error("auth error"));
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "10.0.0.5" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:10.0.0.5");
    });

    it("returns unknown when the socket peer is missing", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: undefined } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:unknown");
    });

    it("uses the configured forwarded hop while retaining the socket as fallback", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return "10.0.0.1, 10.0.0.2";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.168.1.100" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:10.0.0.2");
    });

    it("falls back to the socket peer when x-forwarded-for is empty", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn((_event: any, name: string) => {
            if (name === "x-forwarded-for") return "";
            if (name === "x-real-ip") return "1.2.3.4";
            return undefined;
        });
        process.env.TRUSTED_PROXY_HOPS = "1";

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "192.0.2.10" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:192.0.2.10");
    });

    it("receives the socket address when no trusted hops are set", async () => {
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);
        delete process.env.TRUSTED_PROXY_HOPS;

        const event = makeMockEvent({
            node: { req: { socket: { remoteAddress: "172.16.0.1" } } },
        });
        const id = await getClientIdentifier(event);

        expect(id).toBe("ip:172.16.0.1");
    });
});

// ---------------------------------------------------------------------------
// applyRateLimit
// ---------------------------------------------------------------------------

describe("environment parsing", () => {
    it("falls back to defaults when rate-limit env vars are invalid", async () => {
        const originalValue = process.env.RATE_LIMIT_GENERAL_MAX;
        process.env.RATE_LIMIT_GENERAL_MAX = "not-a-number";
        vi.resetModules();
        const { RATE_LIMIT_GENERAL_MAX } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_GENERAL_MAX).toBe(120);
        if (originalValue === undefined) {
            delete process.env.RATE_LIMIT_GENERAL_MAX;
        } else {
            process.env.RATE_LIMIT_GENERAL_MAX = originalValue;
        }
    });

    it("parses valid rate-limit env vars as integers", async () => {
        const originalValue = process.env.RATE_LIMIT_GENERAL_MAX;
        process.env.RATE_LIMIT_GENERAL_MAX = "1234";
        vi.resetModules();
        const { RATE_LIMIT_GENERAL_MAX } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_GENERAL_MAX).toBe(1234);
        if (originalValue === undefined) {
            delete process.env.RATE_LIMIT_GENERAL_MAX;
        } else {
            process.env.RATE_LIMIT_GENERAL_MAX = originalValue;
        }
    });

    it("parses RATE_LIMIT_AUTH_MAX from environment variable", async () => {
        const original = process.env.RATE_LIMIT_AUTH_MAX;
        process.env.RATE_LIMIT_AUTH_MAX = "300";
        vi.resetModules();
        const { RATE_LIMIT_AUTH_MAX } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_AUTH_MAX).toBe(300);
        if (original === undefined) delete process.env.RATE_LIMIT_AUTH_MAX;
        else process.env.RATE_LIMIT_AUTH_MAX = original;
    });

    it("parses RATE_LIMIT_VOTE_MAX from environment variable", async () => {
        const original = process.env.RATE_LIMIT_VOTE_MAX;
        process.env.RATE_LIMIT_VOTE_MAX = "400";
        vi.resetModules();
        const { RATE_LIMIT_VOTE_MAX } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_VOTE_MAX).toBe(400);
        if (original === undefined) delete process.env.RATE_LIMIT_VOTE_MAX;
        else process.env.RATE_LIMIT_VOTE_MAX = original;
    });

    it("parses RATE_LIMIT_UPLOAD_MAX from environment variable", async () => {
        const original = process.env.RATE_LIMIT_UPLOAD_MAX;
        process.env.RATE_LIMIT_UPLOAD_MAX = "500";
        vi.resetModules();
        const { RATE_LIMIT_UPLOAD_MAX } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_UPLOAD_MAX).toBe(500);
        if (original === undefined) delete process.env.RATE_LIMIT_UPLOAD_MAX;
        else process.env.RATE_LIMIT_UPLOAD_MAX = original;
    });

    it("parses RATE_LIMIT_WINDOW_MS from environment variable", async () => {
        const original = process.env.RATE_LIMIT_WINDOW_MS;
        process.env.RATE_LIMIT_WINDOW_MS = "30000";
        vi.resetModules();
        const { RATE_LIMIT_WINDOW_MS } = await import("~~/server/utils/rateLimit");
        expect(RATE_LIMIT_WINDOW_MS).toBe(30000);
        if (original === undefined) delete process.env.RATE_LIMIT_WINDOW_MS;
        else process.env.RATE_LIMIT_WINDOW_MS = original;
    });
});

// ---------------------------------------------------------------------------
// Rate limit presets
// ---------------------------------------------------------------------------

describe("rate limit presets", () => {
    it("AUTH_RATE_LIMIT_CONFIG has correct defaults", () => {
        expect(AUTH_RATE_LIMIT_CONFIG.maxRequests).toBe(20);
        expect(AUTH_RATE_LIMIT_CONFIG.windowMs).toBe(60_000);
        expect(AUTH_RATE_LIMIT_CONFIG.keyPrefix).toBe("auth");
    });

    it("VOTE_RATE_LIMIT_CONFIG has correct defaults", () => {
        expect(VOTE_RATE_LIMIT_CONFIG.maxRequests).toBe(30);
        expect(VOTE_RATE_LIMIT_CONFIG.windowMs).toBe(60_000);
        expect(VOTE_RATE_LIMIT_CONFIG.keyPrefix).toBe("vote");
    });

    it("JUDGING_DRAFT_RATE_LIMIT_CONFIG allows autosaves and scopes its own bucket", () => {
        expect(JUDGING_DRAFT_RATE_LIMIT_CONFIG.maxRequests).toBe(120);
        expect(JUDGING_DRAFT_RATE_LIMIT_CONFIG.windowMs).toBe(60_000);
        expect(JUDGING_DRAFT_RATE_LIMIT_CONFIG.keyPrefix).toBe("judging-draft");
    });

    it("UPLOAD_RATE_LIMIT_CONFIG has correct defaults", () => {
        expect(UPLOAD_RATE_LIMIT_CONFIG.maxRequests).toBe(10);
        expect(UPLOAD_RATE_LIMIT_CONFIG.windowMs).toBe(60_000);
        expect(UPLOAD_RATE_LIMIT_CONFIG.keyPrefix).toBe("upload");
    });
});

describe("applyRateLimit", () => {
    beforeEach(() => {
        // Clear rate limit history between tests to prevent state leakage
        clearRateLimitHistory();

        // Provide global mocks needed by applyRateLimit
        (globalThis as any).createError = (input: any) => {
            const err = new Error(input.message || input.statusMessage || "Error");
            (err as any).statusCode = input.statusCode ?? input.status ?? 500;
            (err as any).statusMessage = input.statusMessage;
            (err as any).data = input.data;
            return err;
        };
        (globalThis as any).setHeader = vi.fn();
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue("10.0.0.1");
    });

    it("calls the handler when under the rate limit", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler);

        const event = makeMockEvent();
        const result = await wrapped(event);

        expect(result).toEqual({ ok: true });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(event);
    });

    it("allows exactly maxRequests calls before blocking", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 3, windowMs: 60_000 });

        const event = makeMockEvent();

        // First 3 calls should succeed
        await wrapped(event);
        await wrapped(event);
        await wrapped(event);

        expect(handler).toHaveBeenCalledTimes(3);

        // 4th call should throw 429
        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
        });
    });

    it("returns 429 with Retry-After header when limit is exceeded", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });

        const event = makeMockEvent();

        // First call succeeds
        await wrapped(event);

        // Second call should fail with 429
        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
            statusMessage: "Too Many Requests",
        });

        expect((globalThis as any).setHeader).toHaveBeenCalledWith(
            event,
            "Retry-After",
            expect.any(Number),
        );
    });

    it("includes retryAfter and resetTime in the error data", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });

        const event = makeMockEvent();

        await wrapped(event);

        try {
            await wrapped(event);
            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            expect(err.statusCode).toBe(429);
            expect(err.data).toBeDefined();
            expect(err.data.retryAfter).toBeGreaterThan(0);
            expect(err.data.resetTime).toBeDefined();
            expect(err.data.message).toContain("Rate limit exceeded");
        }
    });

    it("respects custom maxRequests and windowMs config", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        // 5 requests per 10 seconds
        const wrapped = applyRateLimit(handler, { maxRequests: 5, windowMs: 10_000 });

        const event = makeMockEvent();

        for (let i = 0; i < 5; i++) {
            await wrapped(event);
        }
        expect(handler).toHaveBeenCalledTimes(5);

        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
        });
    });

    it("uses DEFAULT_RATE_LIMIT_CONFIG when no custom config is provided", async () => {
        // The default is 120 requests per minute
        expect(DEFAULT_RATE_LIMIT_CONFIG.maxRequests).toBe(120);
        expect(DEFAULT_RATE_LIMIT_CONFIG.windowMs).toBe(60_000);

        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler);

        const event = makeMockEvent();

        // Make 120 calls (should all succeed)
        for (let i = 0; i < 120; i++) {
            await wrapped(event);
        }
        expect(handler).toHaveBeenCalledTimes(120);

        // 121st should fail
        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
        });
    });

    it("allows different identifiers to have separate limits", async () => {
        // Two different users should have independent rate limits
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });

        readBasisAuthUserSessionMock
            .mockReturnValueOnce({ userId: 1 })
            .mockReturnValueOnce({ userId: 2 });

        const event1 = makeMockEvent();
        const event2 = makeMockEvent();

        // Both should succeed since they have different identifiers
        await wrapped(event1);
        await wrapped(event2);

        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("throws 429 immediately when maxRequests is 0", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 0, windowMs: 60_000 });

        const event = makeMockEvent();

        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
        });
        expect(handler).not.toHaveBeenCalled();
    });

    it("throws 429 immediately when maxRequests is negative", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: -1, windowMs: 60_000 });

        const event = makeMockEvent();

        await expect(wrapped(event)).rejects.toMatchObject({
            statusCode: 429,
        });
        expect(handler).not.toHaveBeenCalled();
    });

    it("falls back to getClientIdentifier when keyGenerator returns null", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({ user: { id: 77 } });
        const wrapped = applyRateLimit(handler, {
            keyGenerator: () => null,
        });

        const event = makeMockEvent();
        await wrapped(event);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(event);
    });

    it("falls back to getClientIdentifier when keyGenerator returns undefined", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({ user: { id: 88 } });
        const wrapped = applyRateLimit(handler, {
            keyGenerator: () => undefined as any,
        });

        const event = makeMockEvent();
        await wrapped(event);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(event);
    });

    it("deletes stale entries during periodic cleanup", async () => {
        const nowSpy = vi.spyOn(Date, "now");
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });
        const event = makeMockEvent();

        // First request at time 0
        nowSpy.mockReturnValue(0);
        await wrapped(event);

        // Second request 61 minutes later triggers cleanup; the old entry is stale
        nowSpy.mockReturnValue(61 * 60 * 1000);
        await wrapped(event);

        expect(handler).toHaveBeenCalledTimes(2);
        nowSpy.mockRestore();
    });

    it("retains recent entries during periodic cleanup", async () => {
        const nowSpy = vi.spyOn(Date, "now");
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });
        const event = makeMockEvent();

        // First request at time 0
        nowSpy.mockReturnValue(0);
        await wrapped(event);

        // Second request 6 minutes later triggers cleanup; the old entry is still recent
        nowSpy.mockReturnValue(6 * 60 * 1000);
        await wrapped(event);

        expect(handler).toHaveBeenCalledTimes(2);
        nowSpy.mockRestore();
    });

    it("evicts the oldest tracked key when the request history Map exceeds the cap", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        let counter = 0;
        const wrapped = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyGenerator: () => `key-${++counter}`,
        });

        // First request for key-1 succeeds
        await wrapped(makeMockEvent());
        expect(handler).toHaveBeenCalledTimes(1);

        // Create 10_000 additional unique keys to exceed the 10_000 entry cap
        for (let i = 0; i < 10_000; i++) {
            await wrapped(makeMockEvent());
        }
        expect(handler).toHaveBeenCalledTimes(10_001);

        // key-1 should have been evicted, so this is treated as a brand-new first request
        counter = 0;
        await wrapped(makeMockEvent());
        expect(handler).toHaveBeenCalledTimes(10_002);
    }, 30_000);

    it("keyPrefix prepends to the rate limit identifier", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyPrefix: "api",
            keyGenerator: () => "same-key",
        });

        const event = makeMockEvent();
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("different keyPrefix values create independent rate limit counters", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped1 = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyPrefix: "api",
            keyGenerator: () => "user-1",
        });
        const wrapped2 = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyPrefix: "auth",
            keyGenerator: () => "user-1",
        });

        const event = makeMockEvent();
        await wrapped1(event);
        // Same keyGenerator value but different prefix → separate counter
        await wrapped2(event);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("keyGenerator returning a non-null string is used as the identifier", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, {
            maxRequests: 2,
            windowMs: 60_000,
            keyGenerator: () => "custom-id-42",
        });

        const event = makeMockEvent();
        await wrapped(event);
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(2);

        // Third call should hit the limit
        await expect(wrapped(event)).rejects.toMatchObject({ statusCode: 429 });
    });

    it("keyGenerator and keyPrefix compose together", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped1 = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyPrefix: "zone",
            keyGenerator: () => "resource",
        });
        const wrapped2 = applyRateLimit(handler, {
            maxRequests: 1,
            windowMs: 60_000,
            keyPrefix: "zone",
            keyGenerator: () => "resource",
        });

        const event = makeMockEvent();
        // First call uses zone:resource
        await wrapped1(event);
        // Second call uses same prefix+key → should be blocked
        await expect(wrapped2(event)).rejects.toMatchObject({ statusCode: 429 });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("passes through errors thrown by the wrapped handler", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("internal-error"));
        const wrapped = applyRateLimit(handler);
        const event = makeMockEvent();

        await expect(wrapped(event)).rejects.toThrow("internal-error");
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("includes all required fields in the rate-limit error data", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });
        const event = makeMockEvent();

        await wrapped(event);
        try {
            await wrapped(event);
            expect.unreachable("should have thrown");
        } catch (err: any) {
            expect(err.statusCode).toBe(429);
            expect(err.statusMessage).toBe("Too Many Requests");
            expect(err.data).toBeDefined();
            expect(err.data.message).toContain("Rate limit exceeded");
            expect(err.data.retryAfter).toBeGreaterThan(0);
            expect(typeof err.data.retryAfter).toBe("number");
            expect(err.data.resetTime).toBeDefined();
            expect(() => new Date(err.data.resetTime)).not.toThrow();
        }
    });

    it("error retryAfter is an integer number of seconds", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });
        const event = makeMockEvent();

        await wrapped(event);
        try {
            await wrapped(event);
            expect.unreachable("should have thrown");
        } catch (err: any) {
            expect(Number.isInteger(err.data.retryAfter)).toBe(true);
            expect(err.data.retryAfter).toBeGreaterThanOrEqual(1);
        }
    });

    it("resets the counter after the window elapses", async () => {
        const nowSpy = vi.spyOn(Date, "now");
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 10_000 });
        const event = makeMockEvent();

        // First request at time 0
        nowSpy.mockReturnValue(0);
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(1);

        // Second request at time 0 should be blocked
        nowSpy.mockReturnValue(0);
        await expect(wrapped(event)).rejects.toMatchObject({ statusCode: 429 });

        // Third request at time 15_000 (past window) should succeed again
        nowSpy.mockReturnValue(15_000);
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(2);

        nowSpy.mockRestore();
    });

    it("clearRateLimitHistory resets all tracking state", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });
        const event = makeMockEvent();

        // Consume the one allowed request
        await wrapped(event);
        await expect(wrapped(event)).rejects.toMatchObject({ statusCode: 429 });
        expect(handler).toHaveBeenCalledTimes(1);

        // Clear history and try again
        clearRateLimitHistory();
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("limits are independent for different IP addresses", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 1, windowMs: 60_000 });

        (globalThis as any).getUserSession = vi.fn().mockResolvedValue({});
        (globalThis as any).getHeader = vi.fn().mockReturnValue(undefined);

        // User A (IP 10.0.0.1)
        const eventA = makeMockEvent({
            node: { req: { socket: { remoteAddress: "10.0.0.1" } } },
        });
        await wrapped(eventA);
        expect(handler).toHaveBeenCalledTimes(1);

        // User B (IP 10.0.0.2) — different socket address
        const eventB = makeMockEvent({
            node: { req: { socket: { remoteAddress: "10.0.0.2" } } },
        });
        await wrapped(eventB);
        expect(handler).toHaveBeenCalledTimes(2);

        // User A again — should be blocked (second call)
        const eventA2 = makeMockEvent({
            node: { req: { socket: { remoteAddress: "10.0.0.1" } } },
        });
        await expect(wrapped(eventA2)).rejects.toMatchObject({ statusCode: 429 });

        // User B again — should be blocked (second call)
        const eventB2 = makeMockEvent({
            node: { req: { socket: { remoteAddress: "10.0.0.2" } } },
        });
        await expect(wrapped(eventB2)).rejects.toMatchObject({ statusCode: 429 });

        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("sets Retry-After header when maxRequests is zero", async () => {
        (globalThis as any).setHeader = vi.fn();
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 0, windowMs: 60_000 });
        const event = makeMockEvent();

        await expect(wrapped(event)).rejects.toMatchObject({ statusCode: 429 });

        expect((globalThis as any).setHeader).toHaveBeenCalledWith(
            event,
            "Retry-After",
            expect.any(Number),
        );
    });

    it("error data for maxRequests=0 contains message and retryAfter", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, { maxRequests: 0, windowMs: 60_000 });
        const event = makeMockEvent();

        try {
            await wrapped(event);
            expect.unreachable("should have thrown");
        } catch (err: any) {
            expect(err.statusCode).toBe(429);
            expect(err.data).toBeDefined();
            expect(err.data.message).toContain("Rate limit exceeded");
            expect(err.data.retryAfter).toBe(60);
        }
    });

    it("uses AUTH_RATE_LIMIT_CONFIG when passed as config", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, AUTH_RATE_LIMIT_CONFIG);

        const event = makeMockEvent();
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("uses VOTE_RATE_LIMIT_CONFIG when passed as config", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, VOTE_RATE_LIMIT_CONFIG);

        const event = makeMockEvent();
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("uses UPLOAD_RATE_LIMIT_CONFIG when passed as config", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        const wrapped = applyRateLimit(handler, UPLOAD_RATE_LIMIT_CONFIG);

        const event = makeMockEvent();
        await wrapped(event);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
