import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createStorage() {
    const entries = new Map<string, string>();
    return {
        get length() {
            return entries.size;
        },
        clear: () => entries.clear(),
        getItem: (key: string) => entries.get(key) ?? null,
        key: (index: number) => [...entries.keys()][index] ?? null,
        removeItem: (key: string) => {
            entries.delete(key);
        },
        setItem: (key: string, value: string) => {
            entries.set(key, value);
        },
    } as unknown as Storage;
}

describe("API client session expiry drafts", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("defineNuxtPlugin", (plugin: (app?: unknown) => unknown) => plugin);
        vi.stubGlobal("useBasisAuthSession", () => ({ reset: vi.fn() }));
        vi.stubGlobal("window", {
            location: { pathname: "/dashboard/general", search: "?tab=project", assign: vi.fn() },
        });
        vi.stubGlobal("sessionStorage", createStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stores registered unsaved form state before redirecting to login", async () => {
        const { readSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        registerSessionDraft("/dashboard/general", () => ({
            project: { name: "Unsaved project" },
        }));
        vi.stubGlobal(
            "$fetch",
            vi.fn().mockRejectedValue({
                data: { status: 401, code: 401, error: "invalid_token" },
                statusCode: 401,
            }),
        );

        const plugin = (await import("~~/app/plugins/api.client")).default;
        const api = plugin().provide.api as (path: string) => Promise<unknown>;

        await expect(api("/api/teams/1")).rejects.toMatchObject({ status: 401 });
        expect(readSessionDraft("/dashboard/general")).toEqual({
            project: { name: "Unsaved project" },
        });
        expect(window.location.assign).toHaveBeenCalledWith(
            "/api/login?redirect=%2Fdashboard%2Fgeneral%3Ftab%3Dproject",
        );
    });
});
