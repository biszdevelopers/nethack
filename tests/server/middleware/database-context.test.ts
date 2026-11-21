import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("~~/server/database", () => ({ getDb }));

describe("database request middleware", () => {
    let middleware: (event: any) => Promise<void>;

    beforeAll(async () => {
        setupNitroGlobals();
        middleware = (await import("~~/server/middleware/02.database")).default;
    });

    it("attaches the initialized Drizzle instance to every request context", async () => {
        const database = { select: vi.fn() };
        getDb.mockResolvedValue(database);
        const event = { context: {} };

        await middleware(event);

        expect(getDb).toHaveBeenCalledOnce();
        expect(event.context.drizzle).toBe(database);
    });

    it("does not wait for startup migrations on health probes", async () => {
        getDb.mockClear();
        const event = { path: "/api/health/ready", context: {} };

        await middleware(event);

        expect(getDb).not.toHaveBeenCalled();
        expect(event.context.drizzle).toBeUndefined();
    });

    it("treats an event without a path as non-health traffic", async () => {
        getDb.mockClear();
        getDb.mockResolvedValue({ select: vi.fn() });
        const event: { context: Record<string, unknown>; path?: string } = { context: {} };

        await middleware(event);

        expect(getDb).toHaveBeenCalledOnce();
        expect(event.context.drizzle).toBeDefined();
    });

    it("treats a path without segments as non-health traffic", async () => {
        // Split always returns a segment; simulate the defensive fallback directly.
        getDb.mockClear();
        getDb.mockResolvedValue({ select: vi.fn() });
        const split = vi.spyOn(String.prototype, "split").mockReturnValueOnce([] as never);
        const event = { path: "/api/teams", context: {} };

        try {
            await middleware(event);
        } finally {
            split.mockRestore();
        }

        expect(getDb).toHaveBeenCalledOnce();
        expect(event.context.drizzle).toBeDefined();
    });
});
