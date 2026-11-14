import { computed, ref, type Ref, watch as vueWatch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RubricTemplateSummary } from "~~/app/components/admin/rubric-types";

const states = new Map<string, Ref<unknown>>();

const useState = (key: string, initial: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(initial()));
    return states.get(key)!;
};

beforeEach(() => {
    vi.resetModules();
    states.clear();
    vi.stubGlobal("useState", useState);
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("watch", vueWatch);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("application utility modules", () => {
    it("escapes all HTML metacharacters and preserves ordinary text", async () => {
        const { escapeHtml } = await import("~~/app/utils/sanitize");

        expect(escapeHtml(`& < > \" '\nplain`)).toBe("&amp; &lt; &gt; &quot; &#39;\nplain");
        expect(escapeHtml("")).toBe("");
    });

    it("finishes the loading indicator after success and returns the callback value", async () => {
        const start = vi.fn();
        const finish = vi.fn();
        vi.stubGlobal("useLoadingIndicator", () => ({ start, finish }));
        const { withLoadingIndicator } = await import("~~/app/utils/loading");

        await expect(withLoadingIndicator(async () => "saved")).resolves.toBe("saved");
        expect(start).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledWith();
    });

    it("finishes with an error marker and rethrows callback failures", async () => {
        const start = vi.fn();
        const finish = vi.fn();
        const failure = new Error("save failed");
        vi.stubGlobal("useLoadingIndicator", () => ({ start, finish }));
        const { withLoadingIndicator } = await import("~~/app/utils/loading");

        await expect(withLoadingIndicator(async () => Promise.reject(failure))).rejects.toBe(
            failure,
        );
        expect(start).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledWith({ error: true });
    });

    it("returns strings and useful fetch error messages from every supported shape", async () => {
        const { FetchError } = await import("ofetch");
        const { getErrorMessage } = await import("~~/app/utils/errors");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        expect(getErrorMessage("plain message")).toBe("plain message");
        expect(getErrorMessage({ reason: "unknown" })).toBe("[object Object]");

        const apiError = new FetchError("request failed");
        Object.assign(apiError, {
            data: { message: "friendly message" },
            statusMessage: "Bad request",
        });
        expect(getErrorMessage(apiError)).toBe("friendly message");
        expect(log).toHaveBeenCalledWith(
            apiError.message,
            apiError.data,
            apiError.stack,
            "Bad request",
        );

        const emptyDataError = new FetchError("fallback message");
        Object.assign(emptyDataError, { data: { message: "" } });
        expect(getErrorMessage(emptyDataError)).toBe("fallback message");

        const noMessageError = new FetchError("missing message property");
        Object.assign(noMessageError, { data: { detail: "not a message" } });
        expect(getErrorMessage(noMessageError)).toBe("missing message property");

        const noDataError = new FetchError("empty fetch data");
        Object.assign(noDataError, { data: "" });
        expect(getErrorMessage(noDataError)).toBe("empty fetch data");

        const primitiveDataError = new FetchError("primitive fallback");
        Object.assign(primitiveDataError, { data: "not an object" });
        expect(getErrorMessage(primitiveDataError)).toBe("primitive fallback");
    });

    it("recovers when formatting an unexpected error first throws", async () => {
        const { getErrorMessage } = await import("~~/app/utils/errors");
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let coercions = 0;
        const oddError = {
            [Symbol.toPrimitive]() {
                coercions += 1;
                if (coercions === 1) throw new Error("format failed once");
                return "recovered error";
            },
        };

        expect(getErrorMessage(oddError)).toBe("recovered error");
        expect(errorLog).toHaveBeenCalledWith(
            "Error trying to get error message:",
            expect.any(Error),
        );
    });

    it("exports the website name constant", async () => {
        const { WEBSITE_NAME } = await import("~~/app/utils/consts");

        expect(WEBSITE_NAME).toBe("basishacks");
    });

    it("returns the app UI configuration from defineAppConfig", async () => {
        vi.stubGlobal("defineAppConfig", (config: unknown) => config);
        const config = (await import("~~/app/app.config")).default;

        expect(config.ui.container.base).toContain("max-w-none");
        expect(config.ui.formField.slots.label).toBe("block bold text-default");
        expect(config.ui.link.variants.active.false).toBe("text-primary");
    });

    it("keeps rubric template summary as a usable compile-time type", () => {
        const summary: RubricTemplateSummary = {
            id: 12,
            name: "Season rubric",
            description: null,
            definition: { tracks: [] },
            updated_at: new Date("2026-11-12T00:00:00Z"),
        };

        expect(summary).toMatchObject({ id: 12, name: "Season rubric", description: null });
    });
});

describe("server-only app plugin modules", () => {
    it("adds a head nonce marker only when the request provides a nonce", async () => {
        const useHead = vi.fn();
        vi.stubGlobal("defineNuxtPlugin", (plugin: (app?: unknown) => unknown) => plugin);
        vi.stubGlobal("useHead", useHead);
        let requestEvent: unknown;
        vi.stubGlobal("useRequestEvent", () => requestEvent);
        const plugin = (await import("~~/app/plugins/csp-nonce.server")).default;

        plugin();
        expect(useHead).not.toHaveBeenCalled();

        requestEvent = { context: {} };
        plugin();
        expect(useHead).not.toHaveBeenCalled();

        requestEvent = { context: { cspNonce: "nonce-abc" } };
        plugin();
        expect(useHead).toHaveBeenCalledWith({
            script: [{ nonce: "nonce-abc", innerHTML: "/* Per-response CSP nonce marker. */" }],
        });
    });

    it("wraps server fetch once, unwraps API envelopes, and preserves other responses", async () => {
        let envelope: unknown = {
            status: 200,
            code: 200,
            data: { accepted: true },
        };
        const nativeFetch = vi.fn(async (_input: unknown) => envelope);
        vi.stubGlobal("defineNuxtPlugin", (plugin: (app?: unknown) => unknown) => plugin);
        vi.stubGlobal("$fetch", nativeFetch);
        const plugin = (await import("~~/app/plugins/api.server")).default;
        plugin();
        const wrappedFetch = globalThis.$fetch;

        await expect(wrappedFetch<{ accepted: boolean }>("/api/private")).resolves.toEqual({
            accepted: true,
        });
        expect(nativeFetch).toHaveBeenCalledWith("/api/private", undefined);

        await expect(wrappedFetch("/page")).resolves.toEqual({
            status: 200,
            code: 200,
            data: { accepted: true },
        });

        envelope = null;
        await expect(wrappedFetch("/api/empty")).resolves.toBeNull();

        envelope = 42;
        await expect(wrappedFetch("/api/scalar")).resolves.toBe(42);

        envelope = { status: 200, code: 200, data: "empty path" };
        await expect(wrappedFetch(null as never)).resolves.toEqual(envelope);

        const objectFetch = vi.fn(async () => ({ status: 200, code: 200, data: "ok" }));
        vi.stubGlobal("$fetch", objectFetch);
        plugin();
        const objectWrapped = globalThis.$fetch as typeof globalThis.$fetch & {
            [key: symbol]: boolean;
        };
        const objectInput = { toString: () => "/api/resource" };
        await expect(objectWrapped(objectInput)).resolves.toBe("ok");
        expect(objectFetch).toHaveBeenCalledWith(objectInput, undefined);
    });

    it("leaves marked fetch wrappers alone and rejects malformed API envelopes", async () => {
        let envelope: unknown = { status: 200, code: "OK", data: 1 };
        const nativeFetch = vi.fn(async () => envelope);
        vi.stubGlobal("defineNuxtPlugin", (plugin: (app?: unknown) => unknown) => plugin);
        vi.stubGlobal("$fetch", nativeFetch);
        const plugin = (await import("~~/app/plugins/api.server")).default;

        plugin();
        const wrapper = globalThis.$fetch;
        plugin();
        expect(globalThis.$fetch).toBe(wrapper);

        envelope = { status: 99, code: "", data: 1 };
        await expect(globalThis.$fetch("/api/bad-envelope")).rejects.toThrow();
    });
});

describe("session, permission, and API user composables", () => {
    it("reads authenticated session permissions for direct and grouped requirements", async () => {
        const { useNethackPermissions } = await import("~~/app/composables/useNethackPermissions");
        const permissions = ref<string[]>([]);
        vi.stubGlobal("useBasisAuthSession", () => ({ permissions }));
        const state = useNethackPermissions();

        expect(state.permissions.value).toEqual([]);
        expect(state.can("nethack.Teams.create")).toBe(false);
        permissions.value = ["participant"];
        expect(state.can("nethack.Projects.submitOwn")).toBe(true);
        expect(
            state.can({ anyOf: ["nethack.Debug.filesRead", "nethack.Projects.submitOwn"] }),
        ).toBe(true);
        expect(state.can({ allOf: ["nethack.Teams.create", "nethack.Debug.filesRead"] })).toBe(
            false,
        );
    });

    it("refreshes wrapped and direct basis-auth sessions, and derives browser state", async () => {
        const { useBasisAuthSession } = await import("~~/app/composables/useBasisAuthSession");
        const $fetch = vi.fn().mockResolvedValueOnce({
            data: { user: { id: 7 }, permissions: ["participant"], expiresAt: 500 },
        });
        vi.stubGlobal("$fetch", $fetch);
        const session = useBasisAuthSession();

        expect(session.ready.value).toBe(false);
        expect(session.loggedIn.value).toBe(false);
        expect(session.user.value).toBeNull();
        expect(session.permissions.value).toEqual([]);
        await expect(session.refresh()).resolves.toBe(true);
        expect($fetch).toHaveBeenCalledWith("/api/auth/session");
        expect(session.loggedIn.value).toBe(true);
        expect(session.user.value).toEqual({ id: 7 });
        expect(session.permissions.value).toEqual(["participant"]);
        expect(session.ready.value).toBe(true);

        $fetch.mockResolvedValueOnce({ user: { id: 8 }, permissions: [], expiresAt: 600 });
        await expect(session.refresh()).resolves.toBe(true);
        expect(session.user.value).toEqual({ id: 8 });

        session.reset();
        expect(session.session.value).toBeNull();
        expect(session.ready.value).toBe(true);
    });

    it("resets after session refresh failure and always resets after logout", async () => {
        const { useBasisAuthSession } = await import("~~/app/composables/useBasisAuthSession");
        const logoutFailure = new Error("logout failed");
        const $fetch = vi.fn().mockRejectedValueOnce(new Error("session expired"));
        vi.stubGlobal("$fetch", $fetch);
        const session = useBasisAuthSession();

        await expect(session.refresh()).resolves.toBe(false);
        expect(session.session.value).toBeNull();
        expect(session.ready.value).toBe(true);

        session.session.value = { user: { id: 9 }, permissions: [], expiresAt: 700 };
        $fetch.mockResolvedValueOnce(undefined);
        await expect(session.clear()).resolves.toBeUndefined();
        expect($fetch).toHaveBeenLastCalledWith("/api/auth/logout", { method: "POST" });
        expect(session.session.value).toBeNull();

        session.session.value = { user: { id: 10 }, permissions: [], expiresAt: 800 };
        $fetch.mockRejectedValueOnce(logoutFailure);
        await expect(session.clear()).rejects.toBe(logoutFailure);
        expect(session.session.value).toBeNull();
        expect(session.ready.value).toBe(true);
    });

    it("uses user identity, lazy mode, idle refresh, and pending completion in useApiUser", async () => {
        const sessionUser = ref<{ id: number } | null>({ id: 42 });
        const clear = vi.fn(async () => undefined);
        vi.stubGlobal("useBasisAuthSession", () => ({ user: sessionUser, clear }));
        const data = ref<unknown>(null);
        const status = ref("idle");
        const refresh = vi.fn(async () => {
            data.value = { id: 42, username: "r" };
            status.value = "success";
        });
        const fetchResult = { data, status, refresh, error: ref(null) };
        const useFetch = vi.fn(
            async (
                _url: unknown,
                options: {
                    default: () => null;
                    lazy?: boolean;
                    immediate?: boolean;
                    watch?: { value: unknown }[];
                    transform?: (response: unknown) => unknown;
                },
            ) => {
                expect(options.default()).toBeNull();
                return fetchResult;
            },
        );
        vi.stubGlobal("useFetch", useFetch);
        const { useApiUser } = await import("~~/app/composables/useApiUser");

        const result = await useApiUser({ lazy: false });
        expect(useFetch).toHaveBeenCalledOnce();
        const options = useFetch.mock.calls[0]?.[1];
        expect(options.lazy).toBe(false);
        expect(options.immediate).toBe(true);
        expect(options.watch?.[0]?.value).toBe(42);
        expect(options.default()).toBeNull();
        expect(options.transform({ status: 200, code: "ok", data: { id: 42 } })).toEqual({
            id: 42,
        });
        expect(useFetch.mock.calls[0]?.[0]()).toBe("/api/users/42");
        expect(refresh).toHaveBeenCalledOnce();
        expect(result.user).toBe(data);
        expect(result.sessionUser).toBe(sessionUser);
        expect(result.clear).toBe(clear);
    });

    it("skips eager recovery in lazy mode and without a session user", async () => {
        const sessionUser = ref<{ id: number } | null>(null);
        vi.stubGlobal("useBasisAuthSession", () => ({ user: sessionUser, clear: vi.fn() }));
        const fetchResult = {
            data: ref(null),
            status: ref("idle"),
            refresh: vi.fn(),
            error: ref(null),
        };
        const useFetch = vi.fn(
            async (
                _url: unknown,
                options: {
                    default: () => null;
                    lazy?: boolean;
                    immediate?: boolean;
                    watch?: { value: unknown }[];
                    transform?: (response: unknown) => unknown;
                },
            ) => {
                expect(options.default()).toBeNull();
                return fetchResult;
            },
        );
        vi.stubGlobal("useFetch", useFetch);
        const { useApiUser } = await import("~~/app/composables/useApiUser");

        await useApiUser();
        expect(useFetch.mock.calls[0]?.[0]()).toBe("/api/users/undefined");
        expect(useFetch.mock.calls[0]?.[1].immediate).toBe(false);
        expect(fetchResult.refresh).not.toHaveBeenCalled();

        sessionUser.value = { id: 23 };
        await useApiUser({ lazy: true });
        expect(useFetch.mock.calls[1]?.[1].lazy).toBe(true);
        expect(useFetch.mock.calls[1]?.[1].immediate).toBe(true);
        expect(fetchResult.refresh).not.toHaveBeenCalled();
    });

    it("waits for a pending API-user request to settle", async () => {
        const sessionUser = ref<{ id: number } | null>({ id: 5 });
        vi.stubGlobal("useBasisAuthSession", () => ({ user: sessionUser, clear: vi.fn() }));
        const status = ref("pending");
        const stop = vi.fn();
        const watch = vi.fn((_source: unknown, callback: (value: string) => void) => {
            queueMicrotask(() => {
                callback("pending");
                callback("success");
            });
            return stop;
        });
        vi.stubGlobal("watch", watch);
        const fetchResult = { data: ref(null), status, refresh: vi.fn(), error: ref(null) };
        vi.stubGlobal("useFetch", async () => fetchResult);
        const { useApiUser } = await import("~~/app/composables/useApiUser");

        await expect(useApiUser()).resolves.toMatchObject({ user: fetchResult.data });
        expect(watch).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledOnce();
    });
});

describe("authentication route middleware", () => {
    it("does not refresh an already ready and logged-in session", async () => {
        const refresh = vi.fn();
        vi.stubGlobal(
            "defineNuxtRouteMiddleware",
            (middleware: (to: unknown) => unknown) => middleware,
        );
        vi.stubGlobal("useBasisAuthSession", () => ({
            ready: ref(true),
            loggedIn: ref(true),
            refresh,
        }));
        const middleware = (await import("~~/app/middleware/auth")).default;

        await expect(middleware({ fullPath: "/dashboard" } as never)).resolves.toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes an unready session and allows a successful login through", async () => {
        const ready = ref(false);
        const loggedIn = ref(true);
        const refresh = vi.fn(async () => {
            ready.value = true;
        });
        vi.stubGlobal(
            "defineNuxtRouteMiddleware",
            (middleware: (to: unknown) => unknown) => middleware,
        );
        vi.stubGlobal("useBasisAuthSession", () => ({ ready, loggedIn, refresh }));
        const middleware = (await import("~~/app/middleware/auth")).default;

        await expect(middleware({ fullPath: "/teams" } as never)).resolves.toBeUndefined();
        expect(refresh).toHaveBeenCalledOnce();
    });

    it("redirects unauthenticated users to login with their requested path encoded", async () => {
        const ready = ref(true);
        const loggedIn = ref(false);
        const refresh = vi.fn(async () => undefined);
        const navigateTo = vi.fn((path: string, options: unknown) => ({ path, options }));
        vi.stubGlobal(
            "defineNuxtRouteMiddleware",
            (middleware: (to: unknown) => unknown) => middleware,
        );
        vi.stubGlobal("useBasisAuthSession", () => ({ ready, loggedIn, refresh }));
        vi.stubGlobal("navigateTo", navigateTo);
        const middleware = (await import("~~/app/middleware/auth")).default;

        await expect(
            middleware({ fullPath: "/judging/continue?team=2" } as never),
        ).resolves.toEqual({
            path: "/api/login?redirect=%2Fjudging%2Fcontinue%3Fteam%3D2",
            options: { external: true },
        });
        expect(refresh).toHaveBeenCalledOnce();
        expect(navigateTo).toHaveBeenCalledOnce();
    });
});
