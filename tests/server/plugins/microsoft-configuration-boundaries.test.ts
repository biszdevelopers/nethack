import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
    });

beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MICROSOFT_TENANT_ID", "test-tenant");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "test-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "test-secret");
    delete process.env.MICROSOFT_WEBHOOK_STATE;
    delete process.env.CURRENT_URL_ORIGIN;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("Microsoft token configuration boundaries", () => {
    it("leaves the optional form client ID empty if configuration disappears after validation", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ access_token: "application-token" }))
            .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }));
        const graph = await import("~~/server/plugins/microsoft");

        const realEnvironment = globalThis.process.env;
        const clientIdReads = new Map<string, number>();
        const changingEnvironment = new Proxy(realEnvironment, {
            get(target, key, receiver) {
                if (key === "MICROSOFT_CLIENT_ID") {
                    const readCount = (clientIdReads.get("MICROSOFT_CLIENT_ID") ?? 0) + 1;
                    clientIdReads.set("MICROSOFT_CLIENT_ID", readCount);
                    return readCount % 2 === 0 ? "" : "test-client";
                }
                return Reflect.get(target, key, receiver);
            },
        });
        vi.stubGlobal("process", { env: changingEnvironment });

        await expect(graph.default()).resolves.toBe("application-token");
        await expect(graph.initializeDummyUserAccessToken()).resolves.toBe("user-token");

        expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("client_id=&");
        expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("client_id=&");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
