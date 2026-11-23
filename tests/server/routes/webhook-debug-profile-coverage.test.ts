import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    user: null as any,
    profileAsset: { stream: { profile: true }, size: 23 } as any,
    storedNames: vi.fn(async (collection: string, path?: string) => [
        `${collection}:${path ?? "root"}`,
    ]),
    requireUser: vi.fn(async () => ({ id: 9 })),
    assetContentType: vi.fn((path: string) =>
        path.endsWith(".png") ? "image/png" : "application/octet-stream",
    ),
    openStoredAsset: vi.fn(async () => mocks.profileAsset),
    fetch: vi.fn(),
    sendStream: vi.fn((_event: unknown, stream: unknown) => ({ streamed: stream })),
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: any) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/assets", () => ({
    getStoredAssetNames: mocks.storedNames,
    assetContentType: mocks.assetContentType,
    openStoredAsset: mocks.openStoredAsset,
}));
vi.mock("h3", () => ({ sendStream: mocks.sendStream }));
vi.mock("node-fetch", () => ({ default: mocks.fetch }));

describe("debug asset actions", () => {
    let upload: (event: any) => never;
    let files: (event: any) => Promise<any>;
    let event: any;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: any) => handler);
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.message ?? error.statusMessage), {
                ...error,
                statusCode: error.statusCode ?? error.status,
            }),
        );
        event = { node: { req: { body: "multipart" } }, context: { drizzle: {} } };
        mocks.requireUser.mockReset().mockResolvedValue({ id: 9 });
        mocks.storedNames.mockClear();
        upload = (await import("~~/server/api/debug/upload.post")).default;
        files = (await import("~~/server/api/debug/files.get")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it("rejects requests to the retired upload endpoint", () => {
        expect(() => upload(event)).toThrow(expect.objectContaining({ statusCode: 410 }));
        expect(mocks.requireUser).not.toHaveBeenCalled();
    });

    it("returns both asset collections after read permission is granted", async () => {
        await expect(files(event)).resolves.toEqual({
            assets: ["assets:uploads"],
            userast: ["userassets:root"],
        });

        expect(mocks.requireUser).toHaveBeenCalledWith(event, "nethack.Debug.filesRead");
        expect(mocks.storedNames).toHaveBeenNthCalledWith(1, "assets", "uploads");
        expect(mocks.storedNames).toHaveBeenNthCalledWith(2, "userassets");
    });

    it("does not enumerate assets without read permission", async () => {
        const failure = new Error("forbidden");
        mocks.requireUser.mockRejectedValue(failure);

        await expect(files(event)).rejects.toBe(failure);
        expect(mocks.storedNames).not.toHaveBeenCalled();
    });
});

describe("profile picture route", () => {
    let handler: (event: any) => Promise<any>;
    let event: any;
    let id: string;
    let cacheDir: string;

    beforeEach(async () => {
        cacheDir = join(tmpdir(), `basishacks-profile-${randomUUID()}`);
        vi.stubEnv("BASIS_AUTH_PICTURE_CACHE_DIR", cacheDir);
        vi.stubGlobal("defineEventHandler", (handler: any) => handler);
        vi.stubGlobal("getValidatedRouterParams", async () => ({ id }));
        vi.stubGlobal(
            "getUser",
            vi.fn(async () => mocks.user),
        );
        vi.stubGlobal("setResponseHeader", (target: any, name: string, value: unknown) => {
            target.headers[name] = value;
        });
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.message ?? error.statusMessage), {
                ...error,
                statusCode: error.statusCode ?? error.status,
            }),
        );
        id = "1";
        event = { headers: {} };
        mocks.user = null;
        mocks.openStoredAsset.mockReset().mockResolvedValue(mocks.profileAsset);
        mocks.assetContentType.mockClear();
        mocks.sendStream.mockClear();
        mocks.fetch.mockReset();
        vi.stubEnv("BASIS_AUTH_ISSUER", "https://auth.example.test");
        handler = (await import("~~/server/api/users/[id]/profile_picture.get")).default;
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
    });

    it("returns not found for an unknown user", async () => {
        await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect((globalThis as any).getUser).toHaveBeenCalledWith(event, 1);
    });

    it("streams the stored profile image with private safety headers", async () => {
        mocks.user = {
            id: 1,
            email: "person@example.test",
            profile_picture: "profiles/person.png",
        };

        await expect(handler(event)).resolves.toEqual({ streamed: mocks.profileAsset.stream });

        expect(mocks.openStoredAsset).toHaveBeenCalledWith("userassets", "profiles/person.png");
        expect(event.headers).toEqual({
            "Content-Type": "image/png",
            "Content-Length": 23,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        expect(mocks.sendStream).toHaveBeenCalledWith(event, mocks.profileAsset.stream);
    });

    it("generates an identicon when no profile image is stored", async () => {
        mocks.user = { id: 1, email: "person@example.test", profile_picture: null };

        const response = await handler(event);
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));

        expect(Buffer.concat(chunks).subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(event.headers).toEqual({
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        expect(mocks.openStoredAsset).not.toHaveBeenCalled();
    });

    it("rethrows an unexpected stored-asset failure instead of masking it", async () => {
        mocks.user = {
            id: 1,
            email: "person@example.test",
            profile_picture: "profiles/person.png",
        };
        mocks.openStoredAsset.mockRejectedValueOnce(
            Object.assign(new Error("disk offline"), { statusCode: 500 }),
        );

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 500 });
    });

    it("falls back to an identicon when the stored asset is missing", async () => {
        mocks.user = {
            id: 1,
            email: "person@example.test",
            profile_picture: "profiles/missing.png",
        };
        mocks.openStoredAsset.mockRejectedValueOnce(
            Object.assign(new Error("Asset not found"), { statusCode: 404 }),
        );

        const response = await handler(event);
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));

        expect(Buffer.concat(chunks).subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(event.headers["Content-Type"]).toBe("image/png");
    });

    it("serves the provider picture without forwarding credentials or following redirects", async () => {
        const url = "https://auth.example.test/api/picture/person";
        const bytes = Uint8Array.from([71, 73, 70]);
        mocks.user = { id: 1, email: "person@example.test", profile_picture: url };
        mocks.fetch.mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "image/gif; charset=binary" }),
            arrayBuffer: async () => bytes.buffer,
        });

        await expect(handler(event)).resolves.toEqual(Buffer.from(bytes));
        expect(mocks.fetch).toHaveBeenCalledWith(url, {
            redirect: "error",
            signal: expect.any(AbortSignal),
            size: 5 * 1024 * 1024,
        });
        expect(event.headers["Content-Type"]).toBe("image/gif");
        expect(mocks.openStoredAsset).not.toHaveBeenCalled();
    });

    it.each([
        ["another origin", "https://other.example.test/photo.png", undefined],
        ["a credentialed URL", "https://user:pass@auth.example.test/photo.png", undefined],
        ["an unsupported URL scheme", "data:image/png;base64,abc", undefined],
        ["a provider error", "https://auth.example.test/api/picture/person", new Error("offline")],
        [
            "an unsuccessful response",
            "https://auth.example.test/api/picture/person",
            { status: 404 },
        ],
        [
            "a non-image response",
            "https://auth.example.test/api/picture/person",
            { status: 200, type: "text/html" },
        ],
        [
            "an empty image",
            "https://auth.example.test/api/picture/person",
            { status: 200, type: "image/png" },
        ],
    ])("falls back to an identicon for %s", async (_label, url, upstream) => {
        mocks.user = { id: 1, email: "person@example.test", profile_picture: url };
        if (upstream instanceof Error) {
            mocks.fetch.mockRejectedValue(upstream);
        } else if (upstream) {
            mocks.fetch.mockResolvedValue(
                new Response(null, {
                    status: upstream.status,
                    headers: upstream.type ? { "content-type": upstream.type } : {},
                }),
            );
        }

        const response = await handler(event);
        expect(response).toHaveProperty("pipe");
        expect(event.headers["Content-Type"]).toBe("image/png");
        expect(mocks.fetch).toHaveBeenCalledTimes(upstream ? 1 : 0);
        expect(mocks.openStoredAsset).not.toHaveBeenCalled();
    });
});
