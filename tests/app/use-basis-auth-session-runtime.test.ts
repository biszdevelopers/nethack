import { computed, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const states = new Map<string, ReturnType<typeof ref>>();
const serverRuntime = import.meta.server;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    states.clear();
});

it("uses the request-scoped fetch on the server and global fetch in the browser", async () => {
    vi.resetModules();
    states.clear();

    vi.stubGlobal("useState", (key: string, initial: () => unknown) => {
        if (!states.has(key)) states.set(key, ref(initial()));
        return states.get(key)!;
    });
    vi.stubGlobal("computed", computed);

    const browserFetch = vi.fn(async () => ({ user: { id: 9 }, permissions: [], expiresAt: 900 }));
    const requestFetch = vi.fn(async () => ({
        user: { id: 10 },
        permissions: [],
        expiresAt: 1000,
    }));
    vi.stubGlobal("$fetch", browserFetch);
    vi.stubGlobal("useRequestFetch", () => requestFetch);

    const { useBasisAuthSession } = await import("~~/app/composables/useBasisAuthSession");
    const session = useBasisAuthSession();

    await expect(session.refresh()).resolves.toBe(true);
    if (serverRuntime) {
        expect(requestFetch).toHaveBeenCalledWith("/api/auth/session");
        expect(browserFetch).not.toHaveBeenCalled();
        expect(session.user.value).toEqual({ id: 10 });
    } else {
        expect(browserFetch).toHaveBeenCalledWith("/api/auth/session");
        expect(requestFetch).not.toHaveBeenCalled();
        expect(session.user.value).toEqual({ id: 9 });
    }
});

it("uses the request-scoped fetch for the authenticated user request during SSR", async () => {
    const sessionUser = ref({ id: 17 });
    const requestFetch = vi.fn();
    const browserFetch = vi.fn();
    const fetchResult = {
        data: ref({ id: 17, team: null, past_teams: [] }),
        status: ref("success"),
        refresh: vi.fn(),
        error: ref(null),
    };
    const useFetch = vi.fn(
        async (_url: unknown, options: { $fetch: unknown; transform: unknown }) => fetchResult,
    );

    vi.stubGlobal("useBasisAuthSession", () => ({ user: sessionUser, clear: vi.fn() }));
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("useRequestFetch", () => requestFetch);
    vi.stubGlobal("$fetch", browserFetch);
    vi.stubGlobal("useFetch", useFetch);

    const { useApiUser } = await import("~~/app/composables/useApiUser");
    await useApiUser();

    const options = useFetch.mock.calls[0]?.[1];
    expect(options?.$fetch).toBe(serverRuntime ? requestFetch : browserFetch);
    expect(options?.transform).toBeTypeOf("function");
});
