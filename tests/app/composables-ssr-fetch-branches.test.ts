import { computed, ref, watch } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Vitest runs without Nuxt's `import.meta.server` define, so the SSR side of
 * the fetch ternaries never executes. The SSR module object inherits from
 * Object.prototype, so a scoped prototype flag simulates the server build.
 */
function withServerRuntime<T>(run: () => Promise<T>): Promise<T> {
    (Object.prototype as Record<string, unknown>).server = true;
    return run().finally(() => {
        delete (Object.prototype as Record<string, unknown>).server;
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (Object.prototype as Record<string, unknown>).server;
});

describe("SSR request-scoped fetch branches", () => {
    it("refreshes the basis-auth session through useRequestFetch on the server", async () => {
        const states = new Map<string, ReturnType<typeof ref>>();
        vi.stubGlobal("useState", (key: string, initial: () => unknown) => {
            if (!states.has(key)) states.set(key, ref(initial()));
            return states.get(key)!;
        });
        vi.stubGlobal("computed", computed);
        const requestFetch = vi.fn(async () => ({
            user: { id: 10 },
            permissions: ["participant"],
            expiresAt: 1000,
        }));
        const browserFetch = vi.fn();
        vi.stubGlobal("useRequestFetch", () => requestFetch);
        vi.stubGlobal("$fetch", browserFetch);
        const { useBasisAuthSession } = await import("~~/app/composables/useBasisAuthSession");
        const session = useBasisAuthSession();

        await expect(withServerRuntime(() => session.refresh())).resolves.toBe(true);

        expect(requestFetch).toHaveBeenCalledWith("/api/auth/session");
        expect(browserFetch).not.toHaveBeenCalled();
        expect(session.user.value).toEqual({ id: 10 });
    });

    it("passes useRequestFetch to useFetch for the authenticated user on the server", async () => {
        const sessionUser = ref({ id: 17 });
        const requestFetch = vi.fn();
        const browserFetch = vi.fn();
        const fetchResult = {
            data: ref({ id: 17, team: null, past_teams: [] }),
            status: ref("success"),
            refresh: vi.fn(),
            error: ref(null),
        };
        const useFetch = vi.fn(async () => fetchResult);
        vi.stubGlobal("useBasisAuthSession", () => ({ user: sessionUser, clear: vi.fn() }));
        vi.stubGlobal("computed", computed);
        vi.stubGlobal("watch", watch);
        vi.stubGlobal("useRequestFetch", () => requestFetch);
        vi.stubGlobal("$fetch", browserFetch);
        vi.stubGlobal("useFetch", useFetch);
        const { useApiUser } = await import("~~/app/composables/useApiUser");

        await withServerRuntime(() => useApiUser());

        expect(useFetch.mock.calls[0]?.[1]).toMatchObject({ $fetch: requestFetch });
        expect(browserFetch).not.toHaveBeenCalled();
    });
});
