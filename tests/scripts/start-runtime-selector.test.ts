import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const startScript = join(process.cwd(), "scripts", "start.sh");

async function createCommandDirectory(commands: Record<string, string>) {
    const directory = await mkdtemp(join(tmpdir(), "basishacks-start-selector-"));
    temporaryDirectories.push(directory);
    for (const [name, content] of Object.entries(commands)) {
        const path = join(directory, name);
        await writeFile(path, content, "utf8");
        await chmod(path, 0o755);
    }
    return directory;
}

function runStartScript(path: string, logPath: string) {
    return spawnSync("/bin/sh", [startScript], {
        encoding: "utf8",
        env: {
            PATH: path,
            START_SELECTOR_LOG: logPath,
        },
    });
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

describe.skipIf(process.platform === "win32")("production runtime selector", () => {
    it("uses the pinned Bun runtime when Bun 1.3.14 is installed", async () => {
        const directory = await createCommandDirectory({
            bun: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'1.3.14\\n\'; else printf \'bun:%s\\n\' "$*" >> "$START_SELECTOR_LOG"; exit 23; fi\n',
            node: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'v24.0.0\\n\'; else printf \'node:%s\\n\' "$*" >> "$START_SELECTOR_LOG"; exit 24; fi\n',
        });
        const logPath = join(directory, "result.log");

        const result = runStartScript(directory, logPath);

        expect(result.status).toBe(23);
        expect(await readFile(logPath, "utf8")).toBe("bun:start-fix.mjs\n");
    });

    it("falls back to Node when the installed Bun version is not 1.3.14", async () => {
        const directory = await createCommandDirectory({
            bun: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'1.4.4\\n\'; else exit 23; fi\n',
            node: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'v24.0.0\\n\'; else printf \'node:%s\\n\' "$*" >> "$START_SELECTOR_LOG"; exit 24; fi\n',
        });
        const logPath = join(directory, "result.log");

        const result = runStartScript(directory, logPath);

        expect(result.status).toBe(24);
        expect(await readFile(logPath, "utf8")).toBe("node:start-fix.mjs\n");
    });

    it("uses Node when Bun is not installed", async () => {
        const directory = await createCommandDirectory({
            node: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'v24.0.0\\n\'; else printf \'node:%s\\n\' "$*" >> "$START_SELECTOR_LOG"; exit 24; fi\n',
        });
        const logPath = join(directory, "result.log");

        const result = runStartScript(directory, logPath);

        expect(result.status).toBe(24);
        expect(await readFile(logPath, "utf8")).toBe("node:start-fix.mjs\n");
    });

    it("reports an error when neither supported runtime is installed", async () => {
        const directory = await createCommandDirectory({});
        const result = runStartScript(directory, join(directory, "result.log"));

        expect(result.status).toBe(127);
        expect(result.stderr).toContain("Bun 1.3.14 or Node.js 24 or newer");
    });

    it("does not select Node versions below the supported minimum", async () => {
        const directory = await createCommandDirectory({
            node: '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'v22.0.0\\n\'; else exit 24; fi\n',
        });
        const result = runStartScript(directory, join(directory, "result.log"));

        expect(result.status).toBe(127);
        expect(result.stderr).toContain("Bun 1.3.14 or Node.js 24 or newer");
    });
});
