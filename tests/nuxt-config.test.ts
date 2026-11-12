import { describe, it, expect, beforeAll } from "vitest";
import { IconUsageScanner, resolveBundleIcons } from "@nuxt/icon/utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let config: Record<string, any>;

beforeAll(async () => {
    // defineNuxtConfig is an auto-import inside the Nuxt CLI; stub it as the
    // identity function so we can import and inspect nuxt.config.ts in Vitest.
    (globalThis as any).defineNuxtConfig = (cfg: Record<string, any>) => cfg;
    config = (await import("~~/nuxt.config")).default;
});

describe("nuxt production performance defaults", () => {
    it("enables Nitro public asset compression", () => {
        expect(config.nitro).toBeDefined();
        expect(config.nitro?.compressPublicAssets).toBe(true);
    });

    it("uses an import-safe path for the custom Nitro error handler", () => {
        expect(config.nitro?.errorHandler).toMatch(/\/server\/error\.ts$/);
        expect(config.nitro?.errorHandler).not.toContain("\\");
    });

    it("sets long-lived cache headers on static assets", () => {
        expect(config.routeRules).toBeDefined();
        const oneYear = "public, max-age=31536000, immutable";
        expect(config.routeRules?.["/_nuxt/**"].headers?.["Cache-Control"]).toBe(oneYear);
        expect(config.routeRules?.["/assets/**"].headers?.["Cache-Control"]).toBe(oneYear);
        expect(config.routeRules?.["/fonts/**"].headers?.["Cache-Control"]).toBe(oneYear);
    });

    it("uses a stable build target for the supported runtimes", () => {
        // es2020 is kept because the project builds reliably with it; both
        // Node.js >= v24 and Bun fully support it.
        expect(config.vite?.build?.target).toBe("es2020");
    });

    it("configures @nuxt/fonts with display swap and preload", () => {
        expect(config.fonts?.defaults?.display).toBe("swap");
        expect(config.fonts?.defaults?.preload).toBe(true);
        expect(config.fonts?.processCSSVariables).toBe(true);
    });

    it("scans installed icon packages without generated custom collections", () => {
        expect(config.icon?.serverBundle?.collections.length).toBeGreaterThan(0);
        expect(config.icon?.clientBundle?.scan?.globInclude).toEqual([
            "app/**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}",
        ]);
        expect(config.icon?.clientBundle?.icons).toContain("lucide:gem");
        expect(config.icon?.serverBundle?.collections).toEqual(expect.any(Array));
        expect(config.icon?.customCollections).toBeUndefined();
    });

    it("resolves scanned and database-seeded icons from installed collections", async () => {
        const projectRoot = resolve(import.meta.dirname, "..");
        const manifest = JSON.parse(
            readFileSync(resolve(projectRoot, "shared/icon-bundle-manifest.json"), "utf8"),
        );
        const scanner = new IconUsageScanner(config.icon?.clientBundle?.scan ?? true);
        const scannedIcons = await scanner.scanFiles(projectRoot);
        const explicitIcons = config.icon?.clientBundle?.icons ?? [];
        const ignoredScanMatches = new Set(manifest.ignoreScanMatches ?? []);
        const requestedScannedIcons = [...scannedIcons].filter(
            (icon) => !ignoredScanMatches.has(icon),
        );
        const bundle = await resolveBundleIcons({
            icons: explicitIcons,
            scannedIcons: requestedScannedIcons,
            resolvePaths: [projectRoot],
        });
        const bundledIcons = new Set(
            bundle.collections.flatMap((collection) =>
                Object.keys(collection.icons).map((name) => `${collection.prefix}:${name}`),
            ),
        );
        const serverBundleIcons = new Set(
            config.icon.serverBundle.collections.flatMap(
                (collection: { prefix: string; icons: object }) =>
                    Object.keys(collection.icons).map((name) => `${collection.prefix}:${name}`),
            ),
        );

        expect(bundle.failed).toEqual([]);
        expect(bundle.dropped).toEqual([]);
        expect(bundledIcons.has("lucide:gem")).toBe(true);
        expect(bundledIcons.has("heroicons:chevron-double-down")).toBe(true);
        expect(bundledIcons.has("lucide:chevron-down")).toBe(true);
        expect(bundledIcons.has("lucide:loader-circle")).toBe(true);
        expect(bundledIcons.has("lucide:search")).toBe(true);
        expect(requestedScannedIcons.filter((icon) => !bundledIcons.has(icon))).toEqual([]);
        expect([...serverBundleIcons].sort()).toEqual([...bundledIcons].sort());
    });
});
