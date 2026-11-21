import { describe, expect, it, vi } from "vitest";
import {
    changedRows,
    firstRow,
    invalidateRequestCaches,
    lockForUpdateIfSupported,
    requestCache,
    supportsRowLocks,
} from "~~/server/utils/database/query";

describe("query result helpers", () => {
    it("returns the first row or undefined", async () => {
        await expect(firstRow(Promise.resolve([{ id: 1 }]))).resolves.toEqual({ id: 1 });
        await expect(firstRow(Promise.resolve([]))).resolves.toBeUndefined();
    });

    it("counts changed RETURNING rows", async () => {
        await expect(changedRows(Promise.resolve([1, 2, 3]))).resolves.toBe(3);
        await expect(changedRows(Promise.resolve([]))).resolves.toBe(0);
    });

    it("adds a row lock only when the query builder supports it", () => {
        const locked = { marker: "locked" };
        const forUpdate = vi.fn(() => locked);
        expect(lockForUpdateIfSupported({ for: forUpdate })).toBe(locked);
        expect(forUpdate).toHaveBeenCalledWith("update");

        const plain = { marker: "plain" };
        expect(lockForUpdateIfSupported(plain)).toBe(plain);
        expect(supportsRowLocks({ for: () => ({}) })).toBe(true);
        expect(supportsRowLocks(plain)).toBe(false);
        expect(supportsRowLocks(null)).toBe(false);
    });
});

describe("request-scoped lookups", () => {
    it("memoizes a successful lookup per event and key", async () => {
        const event = {} as never;
        const load = vi.fn(async () => "value");

        await expect(requestCache(event, "team:1", load)).resolves.toBe("value");
        await expect(requestCache(event, "team:1", load)).resolves.toBe("value");
        await expect(requestCache(event, "team:2", async () => "second")).resolves.toBe("second");

        expect(load).toHaveBeenCalledOnce();
    });

    it("drops a failed lookup so the caller can retry", async () => {
        const event = {} as never;
        const failure = new Error("query failed");
        const load = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce("recovered");

        await expect(requestCache(event, "team:1", load)).rejects.toBe(failure);
        await expect(requestCache(event, "team:1", load)).resolves.toBe("recovered");
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("clears every lookup for an event after a write", async () => {
        const event = {} as never;
        const load = vi.fn(async () => "first");

        await requestCache(event, "team:1", load);
        invalidateRequestCaches(event);
        await requestCache(event, "team:1", load);

        expect(load).toHaveBeenCalledTimes(2);
    });
});
