import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    allIconsPresent: true,
    manifest: JSON.stringify({ devDependencies: { "@iconify-json/lucide": "*" } }),
    existsSync: vi.fn(
        (path: string) =>
            mocks.allIconsPresent || !/node_modules[\\/]@iconify-json[\\/]/.test(path),
    ),
    spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => mocks.manifest) }));

describe("source-only postinstall actions", () => {
    beforeEach(() => {
        mocks.allIconsPresent = true;
        mocks.manifest = JSON.stringify({ devDependencies: { "@iconify-json/lucide": "*" } });
        mocks.existsSync.mockClear();
        mocks.spawnSync.mockReset().mockReturnValue({ status: 0, error: undefined });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const run = async () => {
        vi.resetModules();
        await import("../../scripts/postinstall.mjs");
    };

    it("skips preparation when any icon package is absent", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        mocks.allIconsPresent = false;

        await run();

        expect(info).toHaveBeenCalledWith(
            expect.stringContaining(
                "Skipping source preparation because icon build dependencies are not installed",
            ),
        );
        expect(mocks.spawnSync).not.toHaveBeenCalled();
    });

    it("runs icon bundle generation and Nuxt preparation when icon packages are present", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

        await run();

        expect(mocks.spawnSync).toHaveBeenNthCalledWith(
            1,
            process.execPath,
            ["scripts/generate-icon-server-bundle.mjs"],
            expect.objectContaining({ stdio: "inherit" }),
        );
        expect(mocks.spawnSync).toHaveBeenNthCalledWith(
            2,
            process.execPath,
            ["node_modules/nuxt/bin/nuxt.mjs", "prepare"],
            expect.objectContaining({ stdio: "inherit" }),
        );
        expect(exit).not.toHaveBeenCalled();
    });

    it("accepts a manifest without devDependencies and proceeds with preparation", async () => {
        mocks.manifest = JSON.stringify({});

        await run();

        expect(mocks.existsSync).not.toHaveBeenCalled();
        expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
    });

    it("throws a child process spawn error", async () => {
        const failure = new Error("spawn unavailable");
        mocks.spawnSync.mockReturnValueOnce({ status: null, error: failure });

        await expect(run()).rejects.toBe(failure);
        expect(mocks.spawnSync).toHaveBeenCalledOnce();
    });

    it("sets a failing process status when a preparation child exits unsuccessfully", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        mocks.spawnSync.mockReturnValueOnce({ status: 2, error: undefined });

        await run();

        expect(exit).toHaveBeenCalledWith(2);
    });

    it("uses exit code one when a failed child has no numeric status", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        mocks.spawnSync.mockReturnValueOnce({ status: null, error: undefined });

        await run();

        expect(exit).toHaveBeenCalledWith(1);
    });
});
