import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("useFetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useApiFetch", () => {
    it("unwraps standard API responses while forwarding fetch options", async () => {
        fetchMock.mockReturnValue({ data: { value: 42 } });
        const { useApiFetch } = await import("~~/app/composables/useApiFetch");
        const requestFetch = vi.fn();

        const result = useApiFetch<{ value: number }>("/api/private", {
            $fetch: requestFetch,
            server: false,
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [request, options] = fetchMock.mock.calls[0]!;
        expect(request).toBe("/api/private");
        expect(options).toMatchObject({ $fetch: requestFetch, server: false });
        expect(options.transform({ status: 200, code: "ok", data: { value: 42 } })).toEqual({
            value: 42,
        });
    });

    it("keeps already-unwrapped fetch responses unchanged", async () => {
        fetchMock.mockReturnValue({ data: { id: 3 } });
        const { useApiFetch } = await import("~~/app/composables/useApiFetch");

        useApiFetch<{ id: number }>("/api/resource");

        const options = fetchMock.mock.calls[0]?.[1];
        const payload = { id: 3 };
        expect(options.transform(payload)).toBe(payload);
    });
});
