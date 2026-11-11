import { z } from "zod";

const responseSchema = z.object({
    status: z.number().int().min(100).max(599),
    code: z.union([z.string().min(1), z.number().int()]),
    data: z.unknown(),
});
const marker = Symbol.for("basishacks.api-fetch");

export default defineNuxtPlugin(() => {
    const current = globalThis.$fetch as typeof globalThis.$fetch & Record<symbol, boolean>;
    if (!current[marker]) {
        const nativeFetch = current;
        const request = async <T>(input: any, options?: any): Promise<T> => {
            const value = await nativeFetch(input, options);
            const path = typeof input === "string" ? input : (input?.toString?.() ?? "");
            if (!path.startsWith("/api/") || !value || typeof value !== "object") return value as T;
            return responseSchema.parse(value).data as T;
        };
        Object.defineProperty(request, marker, { value: true });
        globalThis.$fetch = request as typeof globalThis.$fetch;
    }
});
