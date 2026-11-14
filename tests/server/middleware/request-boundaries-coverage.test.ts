import { Readable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("request middleware routing boundaries", () => {
    let bodyLimit: (event: any) => Promise<void>;
    let debugLockdown: (event: any) => Promise<void>;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("createError", (data: any) =>
            Object.assign(new Error(data.statusMessage), data),
        );
        bodyLimit = (await import("~~/server/middleware/01.request-body-limit")).default;
        debugLockdown = (await import("~~/server/middleware/debug-lockdown")).default;
    });

    afterEach(() => vi.unstubAllEnvs());

    const eventFor = (path: string, method: string, body = "payload") => {
        const request = Object.assign(Readable.from([Buffer.from(body)]), { headers: {} });
        return { path, method, node: { req: request }, _requestBody: undefined };
    };

    it("does not buffer non-API requests or API requests using safe methods", async () => {
        const page = eventFor("/teams", "POST");
        const safeApi = eventFor("/api/teams", "GET");

        await expect(bodyLimit(page)).resolves.toBeUndefined();
        await expect(bodyLimit(safeApi)).resolves.toBeUndefined();

        expect(page._requestBody).toBeUndefined();
        expect(safeApi._requestBody).toBeUndefined();
        expect(page.node.req.readableEnded).toBe(false);
        expect(safeApi.node.req.readableEnded).toBe(false);
    });

    it("applies the general cap to profile paths unless the method and exact route both match", async () => {
        const postProfile = eventFor("/api/users/123", "POST");
        const nestedProfilePatch = eventFor("/api/users/123/avatar", "PATCH");

        await bodyLimit(postProfile);
        await bodyLimit(nestedProfilePatch);

        expect(postProfile._requestBody).toEqual(Buffer.from("payload"));
        expect(nestedProfilePatch._requestBody).toEqual(Buffer.from("payload"));
    });

    it("normalizes trailing slashes before blocking debug routes", async () => {
        vi.stubEnv("NODE_ENV", "production");

        await expect(
            debugLockdown({ node: { req: { url: "/api/debug/" } } }),
        ).rejects.toMatchObject({
            statusCode: 404,
        });
        await expect(debugLockdown({ node: { req: { url: "/debug/" } } })).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("allows malformed and root request targets to continue to normal routing", async () => {
        vi.stubEnv("NODE_ENV", "production");

        await expect(
            debugLockdown({ node: { req: { url: "http://[" } } }),
        ).resolves.toBeUndefined();
        await expect(debugLockdown({ node: { req: { url: "/" } } })).resolves.toBeUndefined();
        await expect(debugLockdown({ node: { req: { url: "" } } })).resolves.toBeUndefined();
    });
});
