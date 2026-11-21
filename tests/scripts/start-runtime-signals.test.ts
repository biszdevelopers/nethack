import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    spawnSync: vi.fn(() => ({ status: 1, stdout: "" })),
}));

vi.mock("node:child_process", () => ({
    spawn: mocks.spawn,
    spawnSync: mocks.spawnSync,
}));

import { spawnRuntime } from "../../scripts/start-runtime.mjs";

function child() {
    const emitter = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
    emitter.kill = vi.fn(() => true);
    return emitter;
}

describe("runtime launcher process forwarding", () => {
    it("swallows a null exit code as failure", async () => {
        const process_ = child();
        mocks.spawn.mockReturnValueOnce(process_);

        const running = spawnRuntime("node", ["start-fix.mjs"]);
        process_.emit("exit", null);

        await expect(running).resolves.toBe(1);
    });

    it("forwards termination signals and cleans up listeners", async () => {
        const process_ = child();
        mocks.spawn.mockReturnValueOnce(process_);
        const sigintBefore = process.listenerCount("SIGINT");
        const sigtermBefore = process.listenerCount("SIGTERM");

        const running = spawnRuntime("node", ["start-fix.mjs"]);
        const forwardSigint = process.listeners("SIGINT").at(-1) as (signal: string) => void;
        const forwardSigterm = process.listeners("SIGTERM").at(-1) as (signal: string) => void;
        forwardSigint("SIGINT");
        forwardSigterm("SIGTERM");

        expect(process_.kill).toHaveBeenCalledWith("SIGINT");
        expect(process_.kill).toHaveBeenCalledWith("SIGTERM");

        process_.emit("exit", 0);
        await expect(running).resolves.toBe(0);
        expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
        expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    });

    it("resolves 1 when the launcher cannot spawn", async () => {
        const process_ = child();
        mocks.spawn.mockReturnValueOnce(process_);
        const sigintBefore = process.listenerCount("SIGINT");
        const sigtermBefore = process.listenerCount("SIGTERM");

        const running = spawnRuntime("node", ["start-fix.mjs"]);
        process_.emit("error", new Error("spawn failed"));

        await expect(running).resolves.toBe(1);
        expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
        expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    });
});
