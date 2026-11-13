import { beforeEach, describe, expect, it, vi } from "vitest";

const resetSession = vi.fn();

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("defineNuxtPlugin", (plugin: (app?: unknown) => unknown) => plugin);
    vi.stubGlobal("useBasisAuthSession", () => ({ reset: resetSession }));
    vi.stubGlobal("window", {
        location: { pathname: "/teams/one", search: "?view=results", assign: vi.fn() },
    });
});

async function loadApi(nativeFetch: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("$fetch", nativeFetch);
    const plugin = (await import("~~/app/plugins/api.client")).default;
    return plugin().provide.api as (input: any, options?: unknown) => Promise<unknown>;
}

describe("browser API client action boundaries", () => {
    it("passes non-API results through untouched and supports URL-like fetch inputs", async () => {
        const result = { status: 200, code: 200, data: { untouched: true } };
        const nativeFetch = vi.fn().mockResolvedValue(result);
        const api = await loadApi(nativeFetch);
        const input = { toString: () => "/api/resource" };
        const options = { method: "GET" };

        await expect(api("/outside/resource")).resolves.toBe(result);
        await expect(api(input, options)).resolves.toEqual({ untouched: true });
        expect(nativeFetch).toHaveBeenNthCalledWith(1, "/outside/resource", undefined);
        expect(nativeFetch).toHaveBeenNthCalledWith(2, input, options);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a primitive", 7],
        ["a Blob", new Blob(["file contents"])],
        ["an ArrayBuffer", new ArrayBuffer(3)],
        ["a Response", new Response("response body")],
    ])("passes API %s values through without trying to unwrap them", async (_label, result) => {
        const api = await loadApi(vi.fn().mockResolvedValue(result));

        await expect(api("/api/download")).resolves.toBe(result);
    });

    it("uses an empty path for an absent runtime input and preserves the raw result", async () => {
        const result = { raw: true };
        const nativeFetch = vi.fn().mockResolvedValue(result);
        const api = await loadApi(nativeFetch);

        await expect(api(undefined)).resolves.toBe(result);
        expect(nativeFetch).toHaveBeenCalledWith(undefined, undefined);
    });

    it("unwraps logout responses and clears the browser session after successful logout", async () => {
        const nativeFetch = vi.fn().mockResolvedValue({
            status: 200,
            code: "success",
            data: { loggedOut: true },
        });
        const api = await loadApi(nativeFetch);

        await expect(api("/api/auth/logout")).resolves.toEqual({ loggedOut: true });
        expect(resetSession).toHaveBeenCalledOnce();
    });

    it("converts malformed API envelopes into the safe invalid-response error", async () => {
        const api = await loadApi(vi.fn().mockResolvedValue({ status: 200, code: 200 }));

        await expect(api("/api/resource")).rejects.toMatchObject({
            error: "invalid_response",
            status: 500,
            message: "API request failed",
        });
    });

    it.each(["/api/login", "/outside/resource"])(
        "does not start a login redirect for a 401 from %s",
        async (path) => {
            const nativeFetch = vi.fn().mockRejectedValue({
                data: {
                    status: 401,
                    code: 401,
                    error: "invalid_token",
                    error_description: "Expired",
                },
                statusCode: 401,
            });
            const api = await loadApi(nativeFetch);

            await expect(api(path)).rejects.toMatchObject({ status: 401 });
            expect(resetSession).not.toHaveBeenCalled();
            expect(window.location.assign).not.toHaveBeenCalled();
        },
    );

    it("does not start a login redirect for a non-401 protected API error", async () => {
        const nativeFetch = vi.fn().mockRejectedValue({
            data: {
                status: 403,
                code: 403,
                error: "forbidden",
                error_description: "The account cannot view this resource",
            },
            statusCode: 403,
        });
        const api = await loadApi(nativeFetch);

        await expect(api("/api/private")).rejects.toMatchObject({
            error: "forbidden",
            status: 403,
        });
        expect(resetSession).not.toHaveBeenCalled();
        expect(window.location.assign).not.toHaveBeenCalled();
    });

    it("uses a generic server error when a failed fetch has no API payload or status", async () => {
        const api = await loadApi(vi.fn().mockRejectedValue(new Error("socket detail")));

        await expect(api("/api/private")).rejects.toMatchObject({
            error: "invalid_response",
            status: 500,
            message: "API request failed",
        });
    });
});
