import { APIError } from "@basis/schema/api";
import { z } from "zod";

const responseSchema = z.object({
    status: z.number().int().min(100).max(599),
    code: z.union([z.string().min(1), z.number().int()]),
    data: z.unknown(),
});
const nativeFetch = globalThis.$fetch;
type ApiInput = Parameters<typeof nativeFetch>[0];
type ApiOptions = Parameters<typeof nativeFetch>[1];

export default defineNuxtPlugin(() => {
    const request = async <T>(input: ApiInput, options?: ApiOptions): Promise<T> => {
        const path = typeof input === "string" ? input : (input?.toString() ?? "");
        const isApi = path.startsWith("/api/");
        try {
            const value = await nativeFetch(input, options);
            if (
                !isApi ||
                value === undefined ||
                value === null ||
                typeof value !== "object" ||
                value instanceof Blob ||
                value instanceof ArrayBuffer ||
                value instanceof Response
            ) {
                return value as T;
            }
            const data = responseSchema.parse(value).data as T;
            if (path === "/api/auth/logout") useBasisAuthSession().reset();
            return data;
        } catch (cause: unknown) {
            const failed = cause as { data?: unknown; statusCode?: number };
            const error = APIError.from(
                failed.data,
                new APIError("invalid_response", "API request failed", failed.statusCode ?? 500),
            );
            const isAuthEndpoint = path.startsWith("/api/auth/") || path.startsWith("/api/login");
            if (error.status === 401 && isApi && !isAuthEndpoint) {
                useBasisAuthSession().reset();
                const redirect = `${window.location.pathname}${window.location.search}`;
                window.location.assign(`/api/login?redirect=${encodeURIComponent(redirect)}`);
            }
            throw error;
        }
    };

    globalThis.$fetch = request as typeof globalThis.$fetch;
    return { provide: { api: request } };
});
