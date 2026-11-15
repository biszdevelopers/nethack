import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    ready: { value: false },
    refresh: vi.fn(),
}));

describe("session bootstrap plugin", () => {
    beforeEach(() => {
        vi.resetModules();
        state.ready = { value: false };
        state.refresh = vi.fn(async () => true);
        vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
        vi.stubGlobal("useBasisAuthSession", () => ({
            ready: state.ready,
            refresh: state.refresh,
        }));
    });

    it("loads the session when it has not been refreshed yet", async () => {
        const plugin = (await import("~~/app/plugins/session")).default as (
            app?: unknown,
        ) => Promise<void>;
        await plugin({});

        expect(state.refresh).toHaveBeenCalledOnce();
    });

    it("does not refetch an already-ready session", async () => {
        state.ready = { value: true };
        const plugin = (await import("~~/app/plugins/session")).default as (
            app?: unknown,
        ) => Promise<void>;
        await plugin({});

        expect(state.refresh).not.toHaveBeenCalled();
    });
});
