import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    serve: vi.fn(async (_event: unknown, path: string) => Buffer.from(`served:${path}`)),
    routerParam: vi.fn(),
}));

vi.mock("~~/server/utils/protected-docs", () => ({ serveProtectedDocsFile: mocks.serve }));
vi.mock("h3", () => ({ getRouterParam: mocks.routerParam }));

describe("protected docs routes", () => {
    beforeEach(() => {
        mocks.serve.mockClear();
        mocks.routerParam.mockReset();
        vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);
    });

    afterEach(() => vi.unstubAllGlobals());

    it("serves the docs index from the docs route", async () => {
        const handler = (await import("~~/server/routes/docs.get")).default;
        const event = { context: {} };

        await expect(handler(event)).resolves.toEqual(Buffer.from("served:"));

        expect(mocks.serve).toHaveBeenCalledWith(event, "");
        expect(mocks.routerParam).not.toHaveBeenCalled();
    });

    it("passes the wildcard path to the shared docs handler", async () => {
        const handler = (await import("~~/server/routes/docs/[...path].get")).default;
        const event = { context: {} };
        mocks.routerParam.mockReturnValue("guide/start");

        await expect(handler(event)).resolves.toEqual(Buffer.from("served:guide/start"));

        expect(mocks.routerParam).toHaveBeenCalledWith(event, "path");
        expect(mocks.serve).toHaveBeenCalledWith(event, "guide/start");
    });

    it("falls back to the index when the wildcard param is missing", async () => {
        const handler = (await import("~~/server/routes/docs/[...path].get")).default;
        const event = { context: {} };
        mocks.routerParam.mockReturnValue(undefined);

        await expect(handler(event)).resolves.toEqual(Buffer.from("served:"));

        expect(mocks.serve).toHaveBeenCalledWith(event, "");
    });
});
