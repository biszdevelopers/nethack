import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    isMainModule,
    relocateServerImports,
    runRelocationCliIfMain,
} from "../../scripts/relocate-server-imports.mjs";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "relocate-imports-"));
    roots.push(root);
    return {
        root,
        sourceRoot: join(root, "source root"),
        packageRoot: join(root, "release root"),
    };
}

describe("Nitro import relocation", () => {
    it("walks nested JavaScript files and rewrites source-root dependency file URLs", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const serverDirectory = join(packageRoot, ".output", "server");
        const nested = join(serverDirectory, "nested");
        const dependency = join(sourceRoot, "node_modules", "@scope", "sample", "entry file.js");
        await mkdir(nested, { recursive: true });
        await mkdir(join(dependency, ".."), { recursive: true });
        await writeFile(dependency, "export const ready = true;", "utf8");
        const absoluteUrl = pathToFileURL(dependency).href;
        const sourceFile = join(serverDirectory, "index.mjs");
        await writeFile(sourceFile, `import x from "${absoluteUrl}";`, "utf8");
        await writeFile(join(nested, "ignored.txt"), `import x from "${absoluteUrl}";`, "utf8");
        await writeFile(join(nested, "keep.cjs"), "module.exports = true;", "utf8");

        const rewritten = await relocateServerImports({ serverDirectory, sourceRoot, packageRoot });

        expect(rewritten).toBe(1);
        const source = await readFile(sourceFile, "utf8");
        expect(source).toContain("../../node_modules/%40scope/sample/entry%20file.js");
        expect(source).not.toContain("file://");
    });

    it("uses the generic node_modules fallback when an import does not match the source root", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const serverDirectory = join(packageRoot, "server");
        const dependency = join(sourceRoot, "node_modules", "plain-package", "index.js");
        await mkdir(serverDirectory, { recursive: true });
        await mkdir(join(dependency, ".."), { recursive: true });
        await writeFile(dependency, "export default 1;", "utf8");
        const file = join(serverDirectory, "main.js");
        await writeFile(
            file,
            'import x from "file:///external/node_modules/plain-package/index.js";',
            "utf8",
        );

        await expect(
            relocateServerImports({ serverDirectory, sourceRoot, packageRoot }),
        ).resolves.toBe(1);
        expect(await readFile(file, "utf8")).toContain("../node_modules/plain-package/index.js");
    });

    it("prefixes a dependency path with a dot when it is relative to the package root", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const dependency = join(sourceRoot, "node_modules", "plain-package", "index.js");
        await mkdir(join(packageRoot, "node_modules", "plain-package"), { recursive: true });
        await mkdir(join(sourceRoot, "node_modules", "plain-package"), { recursive: true });
        await writeFile(dependency, "export default 1;", "utf8");
        const file = join(packageRoot, "root.mjs");
        await writeFile(file, `import x from "${pathToFileURL(dependency).href}";`, "utf8");

        await expect(
            relocateServerImports({ serverDirectory: packageRoot, sourceRoot, packageRoot }),
        ).resolves.toBe(1);
        expect(await readFile(file, "utf8")).toContain("./node_modules/plain-package/index.js");
    });

    it("throws when a referenced package is not present in source node_modules", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const serverDirectory = join(packageRoot, "server");
        await mkdir(serverDirectory, { recursive: true });
        await writeFile(
            join(serverDirectory, "main.mjs"),
            'import x from "file:///outside/node_modules/missing-package/index.js";',
            "utf8",
        );

        await expect(
            relocateServerImports({ serverDirectory, sourceRoot, packageRoot }),
        ).rejects.toThrow("Build imports a dependency that is absent from node_modules");
    });

    it("rejects unresolved file URL imports that do not identify node_modules packages", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const serverDirectory = join(packageRoot, "server");
        await mkdir(serverDirectory, { recursive: true });
        await writeFile(
            join(serverDirectory, "main.mjs"),
            'import x from "file:///outside/generated/custom.js";',
            "utf8",
        );

        await expect(
            relocateServerImports({ serverDirectory, sourceRoot, packageRoot }),
        ).rejects.toThrow("An absolute file URL import remains in the release output");
    });

    it("leaves unrelated file URL text unchanged and counts no replacements", async () => {
        const { sourceRoot, packageRoot } = await fixture();
        const serverDirectory = join(packageRoot, "server");
        await mkdir(serverDirectory, { recursive: true });
        await writeFile(
            join(serverDirectory, "asset.js"),
            'const text = "file:///literal.txt";',
            "utf8",
        );

        await expect(
            relocateServerImports({ serverDirectory, sourceRoot, packageRoot }),
        ).resolves.toBe(0);
    });

    it.each([
        ["Node", process.execPath],
        ["Bun", "bun"],
    ])(
        "runs the CLI entry point under %s with its default directories",
        async (_runtime, command) => {
            const { root } = await fixture();
            await mkdir(join(root, ".output", "server"), { recursive: true });
            const result = spawnSync(
                command,
                [resolve(process.cwd(), "scripts/relocate-server-imports.mjs")],
                { cwd: root, encoding: "utf8" },
            );

            expect(result.status).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout).toContain("Rewrote 0 absolute dependency import(s)");
        },
    );

    it("runs the CLI routine directly and resolves default arguments from each runtime", async () => {
        const { root } = await fixture();
        const serverDirectory = join(root, "server");
        await mkdir(serverDirectory, { recursive: true });
        const info = vi.spyOn(console, "info").mockImplementation(() => {});

        await expect(
            runRelocationCliIfMain({
                metaMain: true,
                args: [serverDirectory, root],
                scriptDirectory: join(root, "scripts"),
            }),
        ).resolves.toBe(true);

        expect(info).toHaveBeenCalledWith(
            "Rewrote 0 absolute dependency import(s) to package-relative paths.",
        );
    });

    it("detects Bun and Node direct execution without misclassifying imports", () => {
        const moduleUrl = pathToFileURL(resolve("scripts/relocate-server-imports.mjs")).href;
        const modulePath = resolve("scripts/relocate-server-imports.mjs");

        expect(isMainModule(true, moduleUrl, undefined)).toBe(true);
        expect(isMainModule(false, moduleUrl, modulePath)).toBe(false);
        expect(isMainModule(undefined, moduleUrl, modulePath)).toBe(true);
        expect(isMainModule(undefined, moduleUrl, undefined)).toBe(false);
        expect(isMainModule(undefined, moduleUrl, resolve("scripts/other.mjs"))).toBe(false);
    });

    it("does not run the CLI body when the module is imported", async () => {
        await expect(
            runRelocationCliIfMain({ metaMain: false, args: ["unused", "unused"] }),
        ).resolves.toBe(false);
    });
});
