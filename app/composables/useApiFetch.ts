import { unwrapApiResponseData } from "~~/app/utils/api-response";

type UseApiFetchOptions<DataT> = NonNullable<Parameters<typeof useFetch<DataT>>[1]>;

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
