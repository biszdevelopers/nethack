import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("site origin plugin", () => {
    let runtimeConfig: { public: Record<string, unknown> };

    beforeEach(() => {
        vi.resetModules();
        runtimeConfig = { public: {} };
        vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
        vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    const loadPlugin = async () =>
        (await import("~~/app/plugins/site-origin.server")).default as () => void;

    it("overrides the public site origin when CURRENT_URL_ORIGIN is configured", async () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://hack.example.test");
        const plugin = await loadPlugin();

        plugin();

        expect(runtimeConfig.public.siteOrigin).toBe("https://hack.example.test");
    });

    it("leaves the runtime configuration untouched without a configured origin", async () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");
        const plugin = await loadPlugin();

        plugin();

        expect(runtimeConfig.public).not.toHaveProperty("siteOrigin");
    });
});
