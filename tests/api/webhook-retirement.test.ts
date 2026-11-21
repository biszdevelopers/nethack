import { beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "./helpers";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let lifecycle: any;
let update: any;

beforeAll(async () => {
    setupNitroGlobals();
    lifecycle = (await import("~~/server/api/_webhooks/lifecycle.post")).default;
    update = (await import("~~/server/api/_webhooks/update.post")).default;
});

describe("retired Microsoft Graph webhooks", () => {
    it.each([
        ["lifecycle", () => lifecycle],
        ["update", () => update],
    ])("keeps the %s endpoint closed with 404", async (_name, handler) => {
        await expect(handler()({ context: {} })).rejects.toMatchObject({
            statusCode: 404,
            message: "Not found",
        });
    });
});
