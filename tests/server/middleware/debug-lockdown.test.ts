import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupNitroGlobals } from "../../api/helpers";

describe("debug route lockdown middleware", () => {
    let middleware: (event: any) => Promise<void>;

    beforeAll(async () => {
        setupNitroGlobals();
        middleware = (await import("~~/server/middleware/debug-lockdown")).default;
    });

    afterEach(() => vi.unstubAllEnvs());

    const eventFor = (url: string) => ({ node: { req: { url } } });

    it.each(["/api/debug", "/api/debug/files?sort=name", "/debug", "/debug/deepseek?tab=chat"])(
        "returns 404 for production debug route %s even without the explicit flag",
        async (url) => {
            vi.stubEnv("NODE_ENV", "production");
            vi.stubEnv("DISABLE_DEBUG_ROUTES", "");
            await expect(middleware(eventFor(url))).rejects.toMatchObject({ statusCode: 404 });
        },
    );

    it("still allows debug routes in development unless the explicit flag is enabled", async () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("DISABLE_DEBUG_ROUTES", "false");
        await expect(middleware(eventFor("/api/debug/files"))).resolves.toBeUndefined();

        vi.stubEnv("DISABLE_DEBUG_ROUTES", "yes");
        await expect(middleware(eventFor("/api/debug/files"))).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("does not block similarly prefixed non-debug routes", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(middleware(eventFor("/api/debugger"))).resolves.toBeUndefined();
        await expect(middleware(eventFor("/debugger"))).resolves.toBeUndefined();
    });
});
