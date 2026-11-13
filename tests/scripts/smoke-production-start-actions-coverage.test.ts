import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    child: undefined as any,
    server: undefined as any,
    spawn: vi.fn((..._args: any[]) => state.child),
    createServer: vi.fn(() => state.server),
}));

vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("node:net", () => ({ createServer: state.createServer }));

const originalArgv = [...process.argv];
let platformDescriptor: PropertyDescriptor | undefined;

function fakeChild(overrides: Record<string, unknown> = {}) {
    const stdout = new EventEmitter() as EventEmitter & {
        setEncoding: (encoding: string) => EventEmitter;
    };
    const stderr = new EventEmitter() as EventEmitter & {
        setEncoding: (encoding: string) => EventEmitter;
    };
    stdout.setEncoding = vi.fn(() => stdout);
    stderr.setEncoding = vi.fn(() => stderr);
    const child = Object.assign(new EventEmitter(), {
        pid: 12345,
        exitCode: null as number | null,
        signalCode: null as string | null,
        stdout,
        stderr,
        kill: vi.fn(() => {
            queueMicrotask(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    child.exitCode = 0;
                    child.emit("exit", 0, null);
                }
            });
        }),
        ...overrides,
    });
    return child;
}

function fakeServer(options: { address?: any; listenError?: Error; closeError?: Error } = {}) {
    const server = new EventEmitter() as any;
    server.listen = vi.fn((_port: number, _host: string, callback: () => void) => {
        if (options.listenError) server.emit("error", options.listenError);
        else callback();
    });
    server.address = vi.fn(() =>
        Object.hasOwn(options, "address") ? options.address : { port: 45678, address: "127.0.0.1" },
    );
    server.close = vi.fn((callback?: (error?: Error) => void) => callback?.(options.closeError));
    return server;
}

describe("production startup smoke runner", () => {
    beforeEach(() => {
        process.argv.splice(0, process.argv.length, ...originalArgv);
        delete process.argv[2];
        state.child = fakeChild();
        state.server = fakeServer();
        state.spawn.mockClear();
        state.createServer.mockClear();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ status: 200, text: async () => "ok" })),
        );
        vi.stubGlobal("console", { ...console, info: vi.fn(), error: vi.fn(), warn: vi.fn() });
        platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        process.argv.splice(0, process.argv.length, ...originalArgv);
        if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    });

    const run = async (runtime: string) => {
        process.argv[2] = runtime;
        vi.resetModules();
        await import("../../scripts/smoke-production-start.mjs");
    };

    it("rejects an unsupported runtime argument", async () => {
        await expect(run("deno")).rejects.toThrow("<bun|node>");
        expect(state.createServer).not.toHaveBeenCalled();
        expect(state.spawn).not.toHaveBeenCalled();
    });

    it.each([
        ["node", process.execPath, ["start-fix.mjs"]],
        ["bun", "bun", ["run", "start"]],
    ])(
        "starts the %s runtime and accepts its database-backed health response",
        async (runtime, command, args) => {
            await run(runtime);

            expect(state.spawn).toHaveBeenCalledWith(
                command,
                args,
                expect.objectContaining({
                    cwd: process.cwd(),
                    env: expect.objectContaining({
                        NODE_ENV: "production",
                        HOST: "127.0.0.1",
                        PORT: "45678",
                    }),
                    stdio: ["ignore", "pipe", "pipe"],
                }),
            );
            expect(globalThis.fetch as any).toHaveBeenCalledWith(
                "http://127.0.0.1:45678/api/seasons/active",
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
            expect(state.child.kill).toHaveBeenCalledWith("SIGTERM");
        },
    );

    it("retries failed and non-ready requests until the active-season endpoint responds", async () => {
        const fetch = vi
            .fn()
            .mockRejectedValueOnce("connection refused")
            .mockResolvedValueOnce({ status: 503, text: async () => "warming" })
            .mockResolvedValueOnce({ status: 200, text: async () => "ready" });
        vi.stubGlobal("fetch", fetch);

        await run("node");

        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("includes spawn errors and bounded child output in startup failures", async () => {
        const failure = new Error("spawn failed");
        state.child = fakeChild();
        const originalOnce = state.child.once.bind(state.child);
        vi.spyOn(state.child, "once").mockImplementation(
            (event: string, listener: (...args: any[]) => void) => {
                originalOnce(event, listener);
                if (event === "error") queueMicrotask(() => state.child.emit("error", failure));
                return state.child;
            },
        );
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("connection refused");
            }),
        );

        await expect(run("node")).rejects.toThrow(/Could not start the node server: spawn failed/);
        expect(state.child.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("reports signal and exit termination before requesting health", async () => {
        state.child = fakeChild({ signalCode: "SIGTERM" });
        await expect(run("node")).rejects.toThrow("terminated by signal SIGTERM");

        state.child = fakeChild({ exitCode: 17 });
        await expect(run("node")).rejects.toThrow("exited with code 17");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("reports the most recent HTTP failure and captured child logs after the deadline", async () => {
        vi.spyOn(Date, "now")
            .mockImplementationOnce(() => 100)
            .mockImplementationOnce(() => 100)
            .mockImplementationOnce(() => 61_000);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                state.child.stdout.emit("data", "server output");
                return { status: 503, text: async () => "database warming" };
            }),
        );

        await expect(run("node")).rejects.toThrow(
            /endpoint returned HTTP 503: database warming[\s\S]*server output/,
        );
    });

    it("rejects an error while reserving an ephemeral port", async () => {
        const failure = new Error("bind failed");
        state.server = fakeServer({ listenError: failure });

        await expect(run("node")).rejects.toBe(failure);
        expect(state.spawn).not.toHaveBeenCalled();
    });

    it.each([null, "pipe"])("rejects an unusable local port address %s", async (address) => {
        state.server = fakeServer({ address });

        await expect(run("node")).rejects.toThrow("Could not allocate a local port");
        expect(state.server.close).toHaveBeenCalled();
    });

    it("propagates failure when closing the temporary listener", async () => {
        state.server = fakeServer({ closeError: new Error("close failed") });

        await expect(run("node")).rejects.toThrow("close failed");
        expect(state.spawn).not.toHaveBeenCalled();
    });

    it("falls back to a child signal when POSIX process-group termination throws", async () => {
        Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
        const kill = vi.spyOn(process, "kill").mockImplementation(() => {
            throw new Error("process group unavailable");
        });

        await run("node");

        expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
        expect(state.child.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("escalates to SIGKILL when a POSIX child ignores SIGTERM", async () => {
        Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
        const kill = vi.spyOn(process, "kill").mockImplementation(() => undefined as any);
        vi.stubGlobal("setTimeout", ((callback: () => void) => {
            queueMicrotask(callback);
            return { unref: vi.fn() } as any;
        }) as any);
        vi.stubGlobal("clearTimeout", vi.fn());

        await run("node");

        expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
        expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
    });

    it("falls back to a child signal when POSIX process-group escalation throws", async () => {
        Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
        const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
            if (signal === "SIGKILL") throw new Error("process group unavailable");
            return true;
        });
        state.child = fakeChild({
            kill: vi.fn((signal: string) => {
                if (signal === "SIGKILL") {
                    state.child.exitCode = 0;
                    state.child.emit("exit", 0, null);
                }
            }),
        });
        vi.stubGlobal("setTimeout", ((callback: () => void) => {
            queueMicrotask(callback);
            return { unref: vi.fn() } as any;
        }) as any);
        vi.stubGlobal("clearTimeout", vi.fn());

        await run("node");

        expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
        expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
        expect(state.child.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("escalates a Windows child directly when it ignores SIGTERM", async () => {
        Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
        state.child = fakeChild({
            kill: vi.fn((signal: string) => {
                if (signal === "SIGKILL") {
                    state.child.exitCode = 0;
                    state.child.emit("exit", 0, null);
                }
            }),
        });
        vi.stubGlobal("setTimeout", ((callback: () => void) => {
            queueMicrotask(callback);
            return { unref: vi.fn() } as any;
        }) as any);
        vi.stubGlobal("clearTimeout", vi.fn());

        await run("node");

        expect(state.child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
        expect(state.child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    });
});
