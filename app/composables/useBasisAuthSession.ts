import { apiFetch } from "~~/app/composables/useApiFetch";

export interface BasisAuthBrowserSession {
    user: { id: number };
    permissions: string[];
    expiresAt: number;
}

/** Browser-safe view of the encrypted HTTP-only basis-auth token cookie. */
export function useBasisAuthSession() {
    const session = useState<BasisAuthBrowserSession | null>("basis-auth-session", () => null);
    const ready = useState<boolean>("basis-auth-session-ready", () => false);
    const loggedIn = computed(() => session.value !== null);
    const user = computed(() => session.value?.user ?? null);
    const permissions = computed(() => session.value?.permissions ?? []);

    const reset = () => {
        session.value = null;
        ready.value = true;
    };

    const refresh = async (): Promise<boolean> => {
        try {
            const request = import.meta.server ? useRequestFetch() : $fetch;
            const response = await request<
                BasisAuthBrowserSession | { data: BasisAuthBrowserSession }
            >("/api/auth/session");
            session.value =
                response && typeof response === "object" && "data" in response
                    ? response.data
                    : response;
            ready.value = true;
            return true;
        } catch {
            reset();
            return false;
        }
    };

    const clear = async () => {
        try {
            await apiFetch("/api/auth/logout", { method: "POST" });
        } finally {
            reset();
        }
    };

    return { session, user, permissions, ready, loggedIn, refresh, clear, reset };
}
