import { computed, ref, watch, type Ref } from "vue";
import { afterEach, describe, it, expect, vi } from "vitest";
import { normalizeApiUserResponse } from "~~/app/composables/useApiUser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "composables", "useApiUser.ts"),
    "utf-8",
);

type TestApiUser = { id: number; team?: { id: number } } | null;
type FetchStatus = "idle" | "pending" | "success" | "error";

async function loadComposableWithMocks(options: {
    sessionUser: Ref<{ id: number } | null>;
    data: Ref<TestApiUser>;
    status: Ref<FetchStatus>;
    error: Ref<unknown>;
    refresh: () => Promise<void>;
}) {
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("watch", watch);
    vi.stubGlobal("useBasisAuthSession", () => ({ user: options.sessionUser, clear: vi.fn() }));
    vi.stubGlobal("useFetch", async () => options);
    return import("~~/app/composables/useApiUser");
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe("useApiUser composable", () => {
    it("uses the basis-auth cookie session composable internally", () => {
        expect(source).toContain("useBasisAuthSession()");
    });

    it("types the user API response", () => {
        expect(source).toContain("type ApiUser = GetUserResponse | null");
        expect(source).toContain("useFetch<ApiUser>");
    });

    it("null checks userID", () => {
        expect(source).toContain("!userID.value");
    });

    it("unwraps API envelopes and accepts an already normalized user", () => {
        const user = { id: 9, team: { id: 4 } };

        expect(normalizeApiUserResponse({ status: 200, code: "ok", data: user })).toEqual(user);
        expect(normalizeApiUserResponse(user)).toEqual(user);
        expect(normalizeApiUserResponse(null)).toBeNull();
    });

    it("refreshes settled empty user data before returning it", async () => {
        const data = ref<TestApiUser>(null);
        const refresh = vi.fn(async () => {
            data.value = { id: 9, team: { id: 4 } };
        });
        const composable = await loadComposableWithMocks({
            sessionUser: ref({ id: 9 }),
            data,
            status: ref<FetchStatus>("success"),
            error: ref(null),
            refresh,
        });

        const result = await composable.useApiUser();

        expect(refresh).toHaveBeenCalledOnce();
        expect(result.user.value).toEqual({ id: 9, team: { id: 4 } });
    });

    it("waits for pending user data and retries when it remains empty", async () => {
        const data = ref<TestApiUser>(null);
        const status = ref<FetchStatus>("pending");
        const refresh = vi.fn(async () => {
            data.value = { id: 9, team: { id: 4 } };
        });
        const composable = await loadComposableWithMocks({
            sessionUser: ref({ id: 9 }),
            data,
            status,
            error: ref(null),
            refresh,
        });

        const resultPromise = composable.useApiUser();
        setTimeout(() => {
            status.value = "success";
        }, 0);
        const result = await resultPromise;

        expect(refresh).toHaveBeenCalledOnce();
        expect(result.user.value).toEqual({ id: 9, team: { id: 4 } });
    });

    it("does not refresh lazy user data or retry a settled API error", async () => {
        const refresh = vi.fn(async () => undefined);
        const lazyComposable = await loadComposableWithMocks({
            sessionUser: ref({ id: 9 }),
            data: ref<TestApiUser>(null),
            status: ref<FetchStatus>("success"),
            error: ref(null),
            refresh,
        });

        await lazyComposable.useApiUser({ lazy: true });
        expect(refresh).not.toHaveBeenCalled();

        const errorComposable = await loadComposableWithMocks({
            sessionUser: ref({ id: 9 }),
            data: ref<TestApiUser>(null),
            status: ref<FetchStatus>("error"),
            error: ref(new Error("User lookup failed")),
            refresh,
        });

        await errorComposable.useApiUser();
        expect(refresh).not.toHaveBeenCalled();
    });
});
