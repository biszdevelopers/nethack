import type { AsyncData, NuxtError } from "#app";
import type { Ref } from "vue";
import { unwrapApiResponseData } from "~~/app/utils/api-response";

type ApiRequest = string | URL | Request | Ref<string> | (() => string | URL | Request);

/** Fetches an API route and unwraps its response envelope for imperative requests. */
export async function apiFetch<DataT = any>(
    request: ApiRequest,
    options?: Record<string, unknown>,
): Promise<DataT> {
    const app = typeof tryUseNuxtApp === "function" ? tryUseNuxtApp() : null;
    type ApiCall = (request: ApiRequest, options?: Record<string, unknown>) => Promise<unknown>;
    const api = (app?.$api as unknown as ApiCall | undefined) ?? ($fetch as unknown as ApiCall);
    return unwrapApiResponseData<DataT>(await api(request, options));
}

/** Fetches an API route and unwraps its response envelope on both SSR and in the browser. */
export function useApiFetch<DataT = any>(
    request: ApiRequest,
    options?: Record<string, unknown>,
): AsyncData<DataT, NuxtError> {
    return useFetch<DataT>(
        request as never,
        {
            ...options,
            transform: (response: unknown) => unwrapApiResponseData<DataT>(response),
        } as never,
    ) as unknown as AsyncData<DataT, NuxtError>;
}
