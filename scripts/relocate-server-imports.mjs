#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(entryPath)));
        else if (/\.(?:mjs|js|cjs)$/.test(entry.name)) files.push(entryPath);
    }
    return files;
}

function toPortableDependencyPath(specifier, sourceRoot) {
    const decoded = decodeURIComponent(specifier.slice("file://".length)).replaceAll("\\", "/");
    const normalizedRoot = sourceRoot.replaceAll("\\", "/").replace(/\/$/, "");
    const sourceModulesMarker = `${normalizedRoot}/node_modules/`;
    const sourceModulesIndex = decoded.lastIndexOf(sourceModulesMarker);
    const moduleIndex =
        sourceModulesIndex === -1
            ? decoded.lastIndexOf("/node_modules/")
            : sourceModulesIndex + normalizedRoot.length;
    if (moduleIndex === -1) return undefined;

    const packageRelativePath = decoded.slice(moduleIndex + "/node_modules/".length);
    const sourceDependencyPath = resolve(
        sourceRoot,
        "node_modules",
        ...packageRelativePath.split("/"),
    );
    if (!existsSync(sourceDependencyPath)) {
        throw new Error(
            `Build imports a dependency that is absent from node_modules: ${specifier}`,
        );
    }

    return packageRelativePath;
}

/** Rewrite absolute Nitro build imports into paths relative to the release root. */
export async function relocateServerImports({ serverDirectory, sourceRoot, packageRoot }) {
    const files = await walk(serverDirectory);
    let rewrittenImports = 0;

    for (const filePath of files) {
        const original = await readFile(filePath, "utf8");
        const updated = original.replace(/file:\/\/[^"'\s)]+/g, (specifier) => {
            const packageRelativePath = toPortableDependencyPath(specifier, sourceRoot);
            if (!packageRelativePath) return specifier;

            const dependencyPath = resolve(
                packageRoot,
                "node_modules",
                ...packageRelativePath.split("/"),
            );
            let relativeSpecifier = relative(dirname(filePath), dependencyPath)
                .split(sep)
                .join("/");
            if (!relativeSpecifier.startsWith(".")) relativeSpecifier = `./${relativeSpecifier}`;
            rewrittenImports += 1;
            return relativeSpecifier
                .split("/")
                .map((segment) => encodeURIComponent(segment))
                .join("/");
        });

        if (updated !== original) await writeFile(filePath, updated, "utf8");
    }

    for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        if (/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']file:\/\//.test(content)) {
            throw new Error(
                `An absolute file URL import remains in the release output: ${filePath}`,
            );
        }
    }

    return rewrittenImports;
}

if (import.meta.main) {
    const [serverDirectory = ".output/server", packageRoot = "."] = process.argv.slice(2);
    const sourceRoot = resolve(import.meta.dirname, "..");
    const rewrittenImports = await relocateServerImports({
        serverDirectory: resolve(serverDirectory),
        sourceRoot,
        packageRoot: resolve(packageRoot),
    });
    console.info(
        `Rewrote ${rewrittenImports} absolute dependency import(s) to package-relative paths.`,
    );
}
