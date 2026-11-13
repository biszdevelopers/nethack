import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
    manifestJson: "{}",
    scannedIcons: [] as string[],
    bundleResult: { count: 0, collections: [], failed: [], dropped: [] } as any,
    scanFiles: vi.fn(async () => new Set(mocks.scannedIcons)),
    resolveBundleIcons: vi.fn(async () => mocks.bundleResult),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
}));

vi.mock("@nuxt/icon/utils", () => ({
    IconUsageScanner: class {
        async scanFiles(root: string) {
            return mocks.scanFiles(root);
        }
    },
    resolveBundleIcons: mocks.resolveBundleIcons,
}));
vi.mock("node:fs/promises", () => ({
    mkdir: mocks.mkdir,
    readFile: vi.fn(async () => mocks.manifestJson),
    writeFile: mocks.writeFile,
}));

const realManifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "shared/icon-bundle-manifest.json"), "utf8"),
);

function bundleFor(manifest: any, scannedIcons: string[]) {
    const ignored = new Set(manifest.ignoreScanMatches ?? []);
    const requestedScanned = scannedIcons.filter((icon) => !ignored.has(icon));
    const collections = new Map<string, Record<string, unknown>>();
    for (const item of [...manifest.icons, ...requestedScanned]) {
        const icon = item.replace(/^i[-:]/, "");
        const separator = icon.indexOf(":");
        const prefix = icon.slice(0, separator);
        const name = icon.slice(separator + 1);
        const icons = collections.get(prefix) ?? {};
        icons[name] = {};
        collections.set(prefix, icons);
    }
    return {
        count: [...collections.values()].reduce(
            (count, icons) => count + Object.keys(icons).length,
            0,
        ),
        collections: [...collections].map(([prefix, icons]) => ({ prefix, icons })),
        failed: [],
        dropped: [],
    };
}

describe("server icon bundle generation", () => {
    beforeEach(() => {
        mocks.manifestJson = JSON.stringify(realManifest);
        mocks.scannedIcons = [];
        mocks.scanFiles.mockReset().mockImplementation(async () => new Set(mocks.scannedIcons));
        mocks.bundleResult = bundleFor(realManifest, mocks.scannedIcons);
        mocks.resolveBundleIcons.mockReset().mockImplementation(async () => mocks.bundleResult);
        mocks.mkdir.mockReset().mockResolvedValue(undefined);
        mocks.writeFile.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    const run = async () => {
        vi.resetModules();
        await import("../../scripts/generate-icon-server-bundle.mjs");
    };

    it("writes the resolved manifest icons and filters ignored scanner matches", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const manifest = {
            icons: ["lucide:gem", "lucide:arrow-left"],
            ignoreScanMatches: ["ps:5"],
            scan: { globInclude: ["app/**/*.vue"] },
        };
        mocks.manifestJson = JSON.stringify(manifest);
        mocks.scannedIcons = ["ps:5", "lucide:check"];
        mocks.bundleResult = bundleFor(manifest, mocks.scannedIcons);

        await run();

        expect(mocks.scanFiles).toHaveBeenCalledWith(expect.stringContaining("basishacks-r2"));
        expect(mocks.resolveBundleIcons).toHaveBeenCalledWith({
            icons: manifest.icons,
            scannedIcons: ["lucide:check"],
            resolvePaths: [expect.stringContaining("basishacks-r2")],
        });
        expect(mocks.mkdir).toHaveBeenCalledWith(
            expect.stringMatching(/node_modules[\\/]\.cache/),
            {
                recursive: true,
            },
        );
        expect(mocks.writeFile).toHaveBeenCalledWith(
            expect.stringContaining("basishacks-icon-server-bundle.json"),
            JSON.stringify(mocks.bundleResult.collections),
            "utf8",
        );
        expect(info).toHaveBeenCalledWith(expect.stringContaining("Prepared "));
    });

    it.each([
        ["explicit resolution failures", (bundle: any) => (bundle.failed = ["lucide:broken"])],
        ["dropped integration icons", (bundle: any) => (bundle.dropped = ["simple:missing"])],
        ["missing scanned icons", (bundle: any) => (bundle.collections = [])],
    ])("rejects %s", async (_label, mutate) => {
        const manifest = { icons: ["lucide:gem"], scan: {} };
        mocks.manifestJson = JSON.stringify(manifest);
        mocks.bundleResult = bundleFor(manifest, []);
        mutate(mocks.bundleResult);

        await expect(run()).rejects.toThrow("could not be resolved");

        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it("fails if the required database award icon is absent from an otherwise complete bundle", async () => {
        const manifest = { icons: ["lucide:other"], scan: {} };
        mocks.manifestJson = JSON.stringify(manifest);
        mocks.bundleResult = bundleFor(manifest, []);

        await expect(run()).rejects.toThrow("database-seeded award icon lucide:gem is missing");
    });
});
