import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "server", "plugins", "microsoft.ts"),
    "utf-8",
);

describe("microsoft plugin", () => {
    it("does not create an uncleaned refresh interval", () => {
        // Any scheduled interval should be paired with a clearInterval on process close.
        // Currently the plugin refreshes only via lifecycle webhooks, so there is no interval.
        expect(source).not.toContain("setInterval");
    });

    describe("optional startup initialization", () => {
        beforeEach(() => {
            vi.resetModules();
            vi.stubEnv("MICROSOFT_TENANT_ID", "test-tenant");
            vi.stubEnv("MICROSOFT_CLIENT_ID", "test-client");
            vi.stubEnv("MICROSOFT_CLIENT_SECRET", "test-secret");
            vi.stubGlobal("fetch", fetchMock);
            fetchMock.mockReset();
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            vi.spyOn(console, "log").mockImplementation(() => undefined);
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            vi.restoreAllMocks();
            vi.resetModules();
        });

        it("skips initialization when optional Graph credentials are absent", async () => {
            delete process.env.MICROSOFT_TENANT_ID;

            const { default: initialize } = await import("~~/server/plugins/microsoft");

            await expect(initialize()).resolves.toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("keeps the app startup path resolved when the Graph token endpoint is unreachable", async () => {
            fetchMock.mockRejectedValue(new TypeError("network unavailable"));

            const { default: initialize } = await import("~~/server/plugins/microsoft");

            await expect(initialize()).resolves.toBeNull();
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining("Token endpoint is unavailable"),
            );
        });

        it("treats a non-success token response as an unavailable optional integration", async () => {
            fetchMock.mockResolvedValue({ status: 503 });

            const { default: initialize } = await import("~~/server/plugins/microsoft");

            await expect(initialize()).resolves.toBeNull();
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("returned 503"));
        });

        it("initializes and reuses the application token after a successful response", async () => {
            fetchMock.mockResolvedValue({
                status: 200,
                json: vi.fn().mockResolvedValue({ access_token: "graph-token" }),
            });

            const { default: initialize } = await import("~~/server/plugins/microsoft");

            await expect(initialize()).resolves.toBe("graph-token");
            await expect(initialize()).resolves.toBe("graph-token");
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
