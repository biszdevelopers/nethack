import { FetchError } from "ofetch";

/** True when an API error means the endpoint is disabled or absent in this environment. */
export function isEndpointUnavailable(e: unknown): boolean {
    const status =
        (e as { status?: number } | undefined)?.status ??
        (e as { statusCode?: number } | undefined)?.statusCode ??
        (e as { response?: { status?: number } } | undefined)?.response?.status;
    return status === 403 || status === 404;
}

export function getErrorMessage(e: unknown) {
    try {
        if (e instanceof FetchError) {
            try {
                if (e.data) {
                    if ("message" in e.data && e.data.message) {
                        return String(e.data.message);
                    }
                }
            } catch {
                return e.message;
            }
            return e.message;
        }
        if (e instanceof Error && e.message) return e.message;
        return String(e);
    } catch (inner) {
        console.error("Error trying to get error message:", inner);
        return String(e);
    }
}
