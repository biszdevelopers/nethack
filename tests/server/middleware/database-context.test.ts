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
});
