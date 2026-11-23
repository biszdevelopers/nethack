import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~~/server/database", () => ({
    getPostgresClient: () => async () => [{ "?column?": 1 }],
}));

describe("health readiness timer cleanup", () => {
    let ready: (event: any) => Promise<unknown>;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("setHeader", () => undefined);
        vi.stubGlobal("setResponseStatus", () => undefined);
        ready = (await import("~~/server/routes/api/health/ready.get")).default;
    });

    it("skips clearing when the platform timer handle is falsy", async () => {
        const original = globalThis.setTimeout;
        vi.stubGlobal("setTimeout", ((callback: any, delay?: number) => {
            original(callback, delay);
            return 0;
        }) as any);

        try {
            await expect(ready({ path: "/api/health/ready", context: {} })).resolves.toEqual({
                status: "ok",
            });
        } finally {
            vi.stubGlobal("setTimeout", original);
        }
    });
});
