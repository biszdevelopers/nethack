#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bundleCandidates = [
    process.env.NUXT_ICON_CLIENT_BUNDLE,
    resolve(projectRoot, ".nuxt/nuxt-icon-client-bundle.mjs"),
    resolve(projectRoot, "node_modules/.cache/nuxt/.nuxt/nuxt-icon-client-bundle.mjs"),
].filter(Boolean);

let bundlePath;
let bundleSource;
for (const candidate of bundleCandidates) {
    try {
        bundleSource = await readFile(candidate, "utf8");
        bundlePath = candidate;
        break;
    } catch {
        // Try the next Nuxt build directory.
    }
}

if (!bundleSource || !bundlePath) {
    throw new Error(
        "Nuxt Icon client bundle was not found. Run `bun run postinstall` first, then retry.",
    );
}

const match = bundleSource.match(/const collections = JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
if (!match) throw new Error(`Could not parse the Nuxt Icon bundle at ${bundlePath}.`);

const collections = JSON.parse(JSON.parse(match[1]));
if (!Array.isArray(collections) || collections.length === 0) {
    throw new Error("Nuxt Icon produced no scanned icon collections.");
}

const cacheRoot = resolve(projectRoot, "node_modules/.cache");
const outputRoot = resolve(cacheRoot, "basishacks-icon-collections");
if (!outputRoot.startsWith(`${cacheRoot}${sep}`)) {
    throw new Error("Refusing to replace an icon cache outside node_modules/.cache.");
}
await rm(outputRoot, { recursive: true, force: true });
let iconCount = 0;

for (const collection of collections) {
    if (!collection.prefix || !collection.icons || Object.keys(collection.icons).length === 0) {
        throw new Error("Nuxt Icon produced an empty or invalid icon collection.");
    }
    if (!/^[a-z0-9-]+$/.test(collection.prefix)) {
        throw new Error(`Invalid icon collection prefix: ${collection.prefix}`);
    }

    const collectionDirectory = join(outputRoot, collection.prefix);
    await mkdir(collectionDirectory, { recursive: true });
    for (const [name, icon] of Object.entries(collection.icons)) {
        if (!/^[a-z0-9-]+$/.test(name) || typeof icon.body !== "string") {
            throw new Error(`Invalid icon entry in ${collection.prefix}: ${name}`);
        }
        const width = Number(icon.width ?? collection.width ?? 24);
        const height = Number(icon.height ?? collection.height ?? 24);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new Error(`Invalid view box for ${collection.prefix}:${name}`);
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`;
        await writeFile(join(collectionDirectory, `${name}.svg`), svg, "utf8");
        iconCount += 1;
    }
}

console.info(`Synchronized ${iconCount} icons from ${bundlePath} to the build cache.`);
