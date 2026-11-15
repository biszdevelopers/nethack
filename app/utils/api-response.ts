/** Unwraps the standard API envelope while preserving already-normalized payloads. */
export function unwrapApiResponseData<T>(response: unknown): T {
    if (
        response !== null &&
        typeof response === "object" &&
        !Array.isArray(response) &&
        "status" in response &&
        "code" in response &&
        "data" in response
    ) {
        return response.data as T;
    }

    return response as T;
}
