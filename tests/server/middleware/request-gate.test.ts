import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearRateLimitHistory,
    consumeRateLimit,
    REQUEST_GATE_RATE_LIMIT_CONFIG,
} from "~~/server/utils/rateLimit";

const headers: Array<[string, string]> = [];

describe("global request gate", () => {
    let gate: (event: any) => unknown;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("createError", (input: any) =>
            Object.assign(new Error(input.statusMessage), input),
        );
        vi.stubGlobal("setHeader", (_event: unknown, name: string, value: string | number) => {
            headers.push([name, String(value)]);
        });
        gate = (await import("~~/server/middleware/00.request-rate-gate")).default;
    });

    beforeEach(() => {
        clearRateLimitHistory();
        headers.length = 0;
    });

    const eventFor = (path: string, remoteAddress = "198.51.100.7") => ({
        path,
        method: "POST",
        node: { req: { headers: {}, socket: { remoteAddress } } },
    });

    it("ignores page requests and health probes", () => {
        expect(gate(eventFor("/dashboard"))).toBeUndefined();
        expect(gate(eventFor("/api/health/live"))).toBeUndefined();
        expect(gate(eventFor("/api/health/ready"))).toBeUndefined();
        expect(headers).toEqual([]);
    });

    it("exempts the basis-auth backchannel even when the IP gate is saturated", () => {
        for (let index = 0; index <= REQUEST_GATE_RATE_LIMIT_CONFIG.maxRequests; index += 1) {
            consumeRateLimit("gate:ip:198.51.100.7", REQUEST_GATE_RATE_LIMIT_CONFIG);
        }

        expect(gate(eventFor("/api/auth/basis/backchannel"))).toBeUndefined();
    });

    it("allows an ordinary API request while the bucket still has room", () => {
        expect(gate(eventFor("/api/teams"))).toBeUndefined();
        expect(headers).toEqual([]);
    });

    it("rejects ordinary API requests with 429 and Retry-After once the IP bucket is full", () => {
        for (let index = 0; index <= REQUEST_GATE_RATE_LIMIT_CONFIG.maxRequests; index += 1) {
            consumeRateLimit("gate:ip:198.51.100.7", REQUEST_GATE_RATE_LIMIT_CONFIG);
        }

        expect(() => gate(eventFor("/api/teams"))).toThrow(
            expect.objectContaining({ status: 429 }),
        );
        expect(headers).toContainEqual(["Retry-After", expect.any(String)]);
    });
});
