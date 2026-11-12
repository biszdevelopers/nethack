#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IconUsageScanner, resolveBundleIcons } from "@nuxt/icon/utils";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
    await readFile(resolve(projectRoot, "shared/icon-bundle-manifest.json"), "utf8"),
);
const scanner = new IconUsageScanner(manifest.scan);
const scannedIcons = await scanner.scanFiles(projectRoot);
const ignoredScanMatches = new Set(manifest.ignoreScanMatches ?? []);
const requestedScannedIcons = [...scannedIcons].filter((icon) => !ignoredScanMatches.has(icon));
const bundle = await resolveBundleIcons({
    icons: manifest.icons,
    scannedIcons: requestedScannedIcons,
    resolvePaths: [projectRoot],
});

const bundledIcons = new Set(
    bundle.collections.flatMap((collection) =>
        Object.keys(collection.icons).map((name) => `${collection.prefix}:${name}`),
    ),
);
const missingIcons = [...new Set([...manifest.icons, ...requestedScannedIcons])].filter(
    (icon) => !bundledIcons.has(icon.replace(/^i[-:]/, "")),
);
if (bundle.failed.length || bundle.dropped.length || missingIcons.length) {
    throw new Error(
        [
            ...bundle.failed.map((icon) => `Explicit icon could not be resolved: ${icon}`),
            ...bundle.dropped.map((icon) => `Integration icon could not be resolved: ${icon}`),
            ...missingIcons.map((icon) => `Scanned icon could not be resolved: ${icon}`),
        ].join("\n"),
    );
}
if (!bundledIcons.has("lucide:gem")) {
    throw new Error("The database-seeded award icon lucide:gem is missing from the icon bundle.");
}

const cacheDirectory = resolve(projectRoot, "node_modules/.cache");
const outputPath = resolve(cacheDirectory, "basishacks-icon-server-bundle.json");
await mkdir(cacheDirectory, { recursive: true });
await writeFile(outputPath, JSON.stringify(bundle.collections), "utf8");

console.info(
    `Prepared ${bundle.count} server-rendered icons from ${bundle.collections.length} installed collections.`,
);
