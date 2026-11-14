import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assetMocks = vi.hoisted(() => ({
    openStoredAsset: vi.fn(),
    assetContentType: vi.fn((name: string) =>
        name.endsWith(".png") ? "image/png" : "application/octet-stream",
    ),
    isInlineSafeAsset: vi.fn((name: string) => /\.(png|jpg|gif)$/i.test(name)),
    sendStream: vi.fn((event: any, stream: unknown) => ({ event, stream })),
}));

vi.mock("~~/server/utils/assets", () => ({
    openStoredAsset: assetMocks.openStoredAsset,
    assetContentType: assetMocks.assetContentType,
    isInlineSafeAsset: assetMocks.isInlineSafeAsset,
}));
vi.mock("h3", () => ({ sendStream: assetMocks.sendStream }));

type RouteCase = {
    label: string;
    importRoute: () => Promise<{ default: (event: any) => Promise<unknown> }>;
    expectedCollection: string;
    expectedPath: string;
    cache: string;
};

const routes: RouteCase[] = [
    {
        label: "user-upload",
        importRoute: () => import("~~/server/routes/userast/[...path].get"),
        expectedCollection: "userassets",
        expectedPath: "avatar.png",
        cache: "public, max-age=300",
    },
    {
        label: "static-upload",
        importRoute: () => import("~~/server/routes/assets/uploads/[...path].get"),
        expectedCollection: "assets",
        expectedPath: "uploads/avatar.png",
        cache: "public, max-age=3600, immutable",
    },
];

describe.each(routes)(
    "$label public asset route",
    ({ importRoute, expectedCollection, expectedPath, cache }) => {
        let handler: (event: any) => Promise<unknown>;
        let requestedPath: any;
        let event: { headers: Record<string, unknown> };
        const stream = { kind: "readable" };

        beforeEach(async () => {
            vi.stubGlobal("defineEventHandler", (fn: any) => fn);
            vi.stubGlobal("createError", (error: any) =>
                Object.assign(new Error(error.statusMessage ?? error.message), error),
            );
            vi.stubGlobal("getRouterParam", (_event: any, name: string) => {
                expect(name).toBe("path");
                return requestedPath;
            });
            vi.stubGlobal(
                "setResponseHeader",
                (target: typeof event, name: string, value: unknown) => {
                    target.headers[name] = value;
                },
            );
            requestedPath = "avatar.png";
            event = { headers: {} };
            assetMocks.openStoredAsset.mockReset().mockResolvedValue({ stream, size: 17 });
            assetMocks.assetContentType.mockClear();
            assetMocks.isInlineSafeAsset.mockClear();
            assetMocks.sendStream.mockClear();
            handler = (await importRoute()).default;
        });

        afterEach(() => vi.unstubAllGlobals());

        it("returns a secure inline image stream with bounded caching headers", async () => {
            await expect(handler(event)).resolves.toEqual({ event, stream });

            expect(assetMocks.openStoredAsset).toHaveBeenCalledWith(
                expectedCollection,
                expectedPath,
            );
            expect(event.headers).toEqual({
                "Content-Type": "image/png",
                "Content-Length": 17,
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Cross-Origin-Resource-Policy": "same-origin",
                "Cache-Control": cache,
                "Content-Disposition": "inline",
            });
            expect(assetMocks.sendStream).toHaveBeenCalledWith(event, stream);
        });

        it("serves unknown file types as safe downloads", async () => {
            requestedPath = "folder/archive.bin";

            await handler(event);

            expect(assetMocks.openStoredAsset).toHaveBeenCalledWith(
                expectedCollection,
                expectedCollection === "assets"
                    ? "uploads/folder/archive.bin"
                    : "folder/archive.bin",
            );
            expect(event.headers["Content-Disposition"]).toBe('attachment; filename="download"');
        });

        it("uses the download basename fallback when a runtime path has no final segment", async () => {
            requestedPath = { split: () => [] };

            await handler(event);

            expect(assetMocks.assetContentType).toHaveBeenCalledWith("download");
            expect(event.headers["Content-Disposition"]).toBe('attachment; filename="download"');
        });

        it("returns 404 when the route path is missing", async () => {
            requestedPath = undefined;

            await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
            expect(assetMocks.openStoredAsset).not.toHaveBeenCalled();
        });

        it("returns 404 for hidden path segments before opening storage", async () => {
            requestedPath = "folder/.staging/private.tmp";

            await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
            expect(assetMocks.openStoredAsset).not.toHaveBeenCalled();
        });

        it.each(["ENOENT", "ELOOP"])("maps %s file-open errors to 404", async (code) => {
            assetMocks.openStoredAsset.mockRejectedValue(
                Object.assign(new Error("not found"), { code }),
            );

            await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        });

        it("propagates unexpected storage errors", async () => {
            const failure = Object.assign(new Error("disk unavailable"), { code: "EIO" });
            assetMocks.openStoredAsset.mockRejectedValue(failure);

            await expect(handler(event)).rejects.toBe(failure);
        });
    },
);
