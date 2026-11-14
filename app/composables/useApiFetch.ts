import { unwrapApiResponseData } from "~~/app/utils/api-response";

type UseApiFetchOptions<DataT> = NonNullable<Parameters<typeof useFetch<DataT>>[1]>;

/** Fetches an API route and unwraps its response envelope for imperative requests. */
export async function apiFetch<DataT = any>(
    request: Parameters<typeof $fetch>[0],
    options?: Parameters<typeof $fetch>[1],
): Promise<DataT> {
    const api = tryUseNuxtApp()?.$api ?? $fetch;
    return unwrapApiResponseData<DataT>(await api<unknown>(request, options));
}

/** Fetches an API route and unwraps its response envelope on both SSR and in the browser. */
export function useApiFetch<DataT = any>(
    request: Parameters<typeof useFetch<DataT>>[0],
    options?: Omit<UseApiFetchOptions<DataT>, "transform">,
) {
    return useFetch<DataT>(request, {
        ...options,
        transform: (response) => unwrapApiResponseData<DataT>(response),
    });
}
