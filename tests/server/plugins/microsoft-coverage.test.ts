import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const importPlugin = async () => import("~~/server/plugins/microsoft");

describe("Microsoft Graph integration branches", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv("MICROSOFT_TENANT_ID", "test-tenant");
        vi.stubEnv("MICROSOFT_CLIENT_ID", "test-client");
        vi.stubEnv("MICROSOFT_CLIENT_SECRET", "test-secret");
        vi.stubEnv("MICROSOFT_DUMMY_USER_NAME", "dummy@example.test");
        vi.stubEnv("MICROSOFT_DUMMY_USER_PASSWORD", "dummy-password");
        delete process.env.MICROSOFT_WEBHOOK_STATE;
        delete process.env.MICROSOFT_WEBHOOK_ID;
        delete process.env.CURRENT_URL_ORIGIN;
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("createError", (options: { statusCode: number; message: string }) =>
            Object.assign(new Error(options.message), { statusCode: options.statusCode }),
        );
        fetchMock.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    describe("application token and generic requests", () => {
        it("returns a token through the shared initializer and reuses its promise", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ access_token: "app-token" }));
            const graph = await importPlugin();

            await expect(graph.getMSAccessToken()).resolves.toBe("app-token");
            await expect(graph.getMSAccessToken()).resolves.toBe("app-token");
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledWith(
                "https://login.microsoftonline.com/test-tenant/oauth2/v2.0/token",
                expect.objectContaining({
                    method: "POST",
                    body: expect.stringContaining("grant_type=client_credentials"),
                }),
            );
        });

        it("reuses the initialized application token when initialization is called directly again", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ access_token: "app-token" }));
            const graph = await importPlugin();

            await expect(graph.default()).resolves.toBe("app-token");
            await expect(graph.default()).resolves.toBe("app-token");
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("keeps startup resolved when the application token endpoint rejects", async () => {
            fetchMock.mockRejectedValue(new TypeError("network unavailable"));
            const graph = await importPlugin();

            await expect(graph.default()).resolves.toBeNull();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] Token endpoint is unavailable - Microsoft Graph features will be unavailable",
            );
        });

        it("rejects token access when initialization has no token", async () => {
            fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
            const graph = await importPlugin();

            await expect(graph.getMSAccessToken()).rejects.toThrow(
                "[MS Graph] MS Access Token not initialized",
            );
        });

        it("sends GET requests without a body and returns non-401 responses unchanged", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(new Response("accepted", { status: 202 }));
            const graph = await importPlugin();

            const result = await graph.requestMicrosoft("/me", "GET", { ignored: true });

            expect(result.status).toBe(202);
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/me",
                expect.objectContaining({
                    method: "GET",
                    body: null,
                    headers: expect.objectContaining({ Authorization: "Bearer app-token" }),
                }),
            );
        });

        it("serializes object bodies and preserves string bodies", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 204 }))
                .mockResolvedValueOnce(new Response(null, { status: 204 }))
                .mockResolvedValueOnce(new Response(null, { status: 204 }));
            const graph = await importPlugin();

            await graph.requestMicrosoft("/one", "POST", { enabled: true });
            await graph.requestMicrosoft("/two", "PATCH", "raw payload");
            await graph.requestMicrosoft("/three", "POST", null);

            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/one",
                expect.objectContaining({ body: JSON.stringify({ enabled: true }) }),
            );
            expect(fetchMock).toHaveBeenNthCalledWith(
                3,
                "https://graph.microsoft.com/v1.0/two",
                expect.objectContaining({ body: "raw payload" }),
            );
            expect(fetchMock).toHaveBeenNthCalledWith(
                4,
                "https://graph.microsoft.com/v1.0/three",
                expect.objectContaining({ body: "null" }),
            );
        });

        it("refreshes an application token once after a 401", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "old-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(jsonResponse({ access_token: "new-token" }))
                .mockResolvedValueOnce(new Response("ok", { status: 200 }));
            const graph = await importPlugin();

            const result = await graph.requestMicrosoft("/me");

            expect(result.status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(4);
            expect(fetchMock).toHaveBeenNthCalledWith(
                4,
                "https://graph.microsoft.com/v1.0/me",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer new-token" }),
                }),
            );
        });

        it("does not refresh repeatedly when the retried application request is unauthorized", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(jsonResponse({ access_token: "refreshed-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }));
            const graph = await importPlugin();

            const result = await graph.requestMicrosoft("/me");

            expect(result.status).toBe(401);
            expect(fetchMock).toHaveBeenCalledTimes(4);
        });

        it("keeps unavailable Graph credentials optional for generic requests", async () => {
            vi.stubEnv("MICROSOFT_CLIENT_ID", "");
            const graph = await importPlugin();

            await expect(graph.requestMicrosoft("/me")).rejects.toThrow(
                "[MS Graph] MS Access Token not initialized",
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("dummy user requests", () => {
        it("initializes a password grant token and attaches it to user requests", async () => {
            fetchMock
                .mockResolvedValueOnce(
                    jsonResponse({ access_token: "user-token", refresh_token: "refresh-token" }),
                )
                .mockResolvedValueOnce(new Response("ok", { status: 200 }));
            const graph = await importPlugin();

            const result = await graph.requestUserMicrosoft("/me", "GET");

            expect(result.status).toBe(200);
            expect(fetchMock).toHaveBeenNthCalledWith(
                1,
                "https://login.microsoftonline.com/test-tenant/oauth2/v2.0/token",
                expect.objectContaining({
                    body: expect.stringContaining("grant_type=password"),
                }),
            );
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/me",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer user-token" }),
                }),
            );
            expect(graph.getDummyUserAccessToken()).toBe("user-token");
        });

        it("uses empty optional secret and dummy-user credential fields when omitted", async () => {
            delete process.env.MICROSOFT_CLIENT_SECRET;
            delete process.env.MICROSOFT_DUMMY_USER_NAME;
            delete process.env.MICROSOFT_DUMMY_USER_PASSWORD;
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }));
            const graph = await importPlugin();

            await graph.default();
            await graph.initializeDummyUserAccessToken();

            expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("client_secret=");
            expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("username=");
            expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("password=");
            expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("client_secret=");
        });

        it("logs a rejected dummy-user grant and throws when no token was issued", async () => {
            fetchMock.mockResolvedValueOnce(
                jsonResponse({ error_description: "bad dummy credentials" }, 400),
            );
            const graph = await importPlugin();

            await expect(graph.requestUserMicrosoft("/me")).rejects.toThrow(
                "[MS Graph] Dummy User Access Token not initialized",
            );
            expect(console.log).toHaveBeenCalledWith(
                "[MS Graph] Dummy user error: bad dummy credentials",
            );
        });

        it("refreshes a user token after a 401 and retries with the new token", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-old" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-new" }))
                .mockResolvedValueOnce(new Response("ok", { status: 200 }));
            const graph = await importPlugin();

            const result = await graph.requestUserMicrosoft("/me/chats");

            expect(result.status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(4);
            expect(fetchMock).toHaveBeenNthCalledWith(
                4,
                "https://graph.microsoft.com/v1.0/me/chats",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer user-new" }),
                }),
            );
        });

        it("throws after the retried user request is still unauthorized", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-old" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-new" }))
                .mockResolvedValueOnce(new Response(null, { status: 401 }));
            const graph = await importPlugin();

            await expect(graph.requestUserMicrosoft("/me/chats")).rejects.toThrow(
                "[MS Graph] User token refresh failed after retry",
            );
        });

        it("throws when the dummy-user token getter is called before initialization", async () => {
            const graph = await importPlugin();

            expect(() => graph.getDummyUserAccessToken()).toThrow(
                "[MS Graph] Dummy User Access Token not initialized",
            );
        });

        it("does not call the token endpoint when dummy-user configuration is absent", async () => {
            vi.stubEnv("MICROSOFT_TENANT_ID", "");
            const graph = await importPlugin();

            await expect(graph.initializeDummyUserAccessToken()).resolves.toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("also treats a missing client ID as unavailable dummy-user configuration", async () => {
            vi.stubEnv("MICROSOFT_CLIENT_ID", "");
            const graph = await importPlugin();

            await expect(graph.initializeDummyUserAccessToken()).resolves.toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("serializes a null body for non-GET user requests", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 204 }));
            const graph = await importPlugin();

            await graph.requestUserMicrosoft("/me/action", "POST", null);

            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/me/action",
                expect.objectContaining({ body: "null" }),
            );
        });
    });

    describe("meeting and chat wrappers", () => {
        it("creates a UTC meeting with attendee email addresses and the standard disclaimer", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 201 }));
            const graph = await importPlugin();

            const result = await graph.createMicrosoftMeeting(
                "organizer@example.test",
                "Review session",
                "Bring your project demo.",
                "2026-11-14T10:00:00",
                "2026-11-14T11:00:00",
                ["judge@example.test", "participant@example.test"],
            );

            expect(result.status).toBe(201);
            const request = fetchMock.mock.calls[1]?.[1];
            const body = JSON.parse(String(request?.body));
            expect(fetchMock.mock.calls[1]?.[0]).toBe(
                "https://graph.microsoft.com/v1.0/users/organizer@example.test/events",
            );
            expect(body).toMatchObject({
                subject: "Review session",
                body: {
                    contentType: "HTML",
                    content: expect.stringContaining("Bring your project demo."),
                },
                start: { dateTime: "2026-11-14T10:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-11-14T11:00:00", timeZone: "UTC" },
                attendees: [
                    { emailAddress: { address: "judge@example.test" } },
                    { emailAddress: { address: "participant@example.test" } },
                ],
            });
            expect(body.body.content).toContain("basishacks");
        });

        it("creates and caches direct chats, and reports Graph failures or missing IDs", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
                .mockResolvedValueOnce(jsonResponse({ id: "chat-1" }));
            const graph = await importPlugin();

            await expect(graph.createOrGetExistingDirectChat("target-1")).resolves.toEqual({
                id: "chat-1",
            });
            await expect(graph.createOrGetExistingDirectChat("target-1")).resolves.toEqual({
                id: "chat-1",
            });
            expect(fetchMock).toHaveBeenCalledTimes(2);

            fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "denied" } }, 403));
            await expect(graph.createOrGetExistingDirectChat("target-2")).rejects.toMatchObject({
                statusCode: 403,
                message: "denied",
            });

            fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "" } }, 201));
            await expect(graph.createOrGetExistingDirectChat("target-3")).rejects.toMatchObject({
                statusCode: 500,
                message: "Microsoft Graph response missing chat id",
            });

            fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
            await expect(graph.createOrGetExistingDirectChat("target-4")).rejects.toMatchObject({
                statusCode: 503,
                message: "Failed to create or retrieve direct chat",
            });
        });

        it("sends plain and rich messages through the dummy-user request wrapper", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 201 }))
                .mockResolvedValueOnce(new Response(null, { status: 201 }));
            const graph = await importPlugin();

            await graph.sendChatMessage("chat-1", "hello");
            await graph.sendRichChatMessage("chat-1", "<b>hello</b>");

            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/chats/chat-1/messages",
                expect.objectContaining({
                    body: JSON.stringify({
                        body: { contentType: "text", content: "hello" },
                    }),
                }),
            );
            expect(fetchMock).toHaveBeenNthCalledWith(
                3,
                "https://graph.microsoft.com/v1.0/chats/chat-1/messages",
                expect.objectContaining({
                    body: JSON.stringify({
                        body: { contentType: "html", content: "<b>hello</b>" },
                    }),
                }),
            );
        });

        it("polls chatbot message deltas and parses the response", async () => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
                .mockResolvedValueOnce(jsonResponse({ value: [{ id: "message-1" }] }));
            const graph = await importPlugin();

            await expect(graph.pollChatbotMessages()).resolves.toBeUndefined();
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/me/chats/getAllMessages/delta",
                expect.objectContaining({ method: "GET", body: null }),
            );
            expect(console.log).toHaveBeenCalledWith({ value: [{ id: "message-1" }] });
        });
    });

    describe("webhook startup and refresh", () => {
        it("rejects webhook setup for localhost or a missing public origin", async () => {
            const graph = await importPlugin();

            await graph.initializeChatbotWebhook();
            vi.stubEnv("CURRENT_URL_ORIGIN", "http://localhost:3000");
            await graph.initializeChatbotWebhook();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] CURRENT_URL_ORIGIN is not set or is a localhost URL.",
            );
        });

        it("requires a persistent webhook secret with at least 32 encoded bytes", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "short-secret");
            const graph = await importPlugin();

            await graph.initializeChatbotWebhook();

            expect(graph.getMicrosoftWebhookState()).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("at least 32 bytes"));
        });

        it("creates a subscription and stores the subscription ID after token setup", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "0123456789abcdef0123456789abcdef");
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(
                    jsonResponse({ id: "subscription-1", expirationDateTime: "later" }),
                );
            const graph = await importPlugin();

            await expect(graph.default()).resolves.toBe("app-token");

            expect(graph.getMicrosoftWebhookState()).toBe("0123456789abcdef0123456789abcdef");
            expect(graph.getChatbotWebhookId()).toBe("subscription-1");
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/subscriptions",
                expect.objectContaining({
                    method: "POST",
                    body: expect.stringContaining(
                        "https://hackathon.example.test/api/_webhooks/update",
                    ),
                }),
            );
            expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
                "0123456789abcdef0123456789abcdef",
            );
        });

        it("rejects webhook setup when the persistent state is absent", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            const graph = await importPlugin();

            await graph.initializeChatbotWebhook();

            expect(graph.getMicrosoftWebhookState()).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("at least 32 bytes"));
        });

        it("handles subscription creation failures without failing Graph initialization", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "0123456789abcdef0123456789abcdef");
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(jsonResponse({ error: "subscription rejected" }, 400));
            const graph = await importPlugin();

            await expect(graph.default()).resolves.toBe("app-token");
            expect(graph.getChatbotWebhookId()).toBeNull();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] Failed to create chatbot webhook subscription:",
                400,
                { error: "subscription rejected" },
            );
        });

        it("refreshes a configured webhook and safely skips invalid refresh configuration", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "0123456789abcdef0123456789abcdef");
            vi.stubEnv("MICROSOFT_WEBHOOK_ID", "subscription-1");
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockResolvedValueOnce(new Response(null, { status: 202 }));
            const graph = await importPlugin();

            await graph.default();
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                "https://graph.microsoft.com/v1.0/subscriptions/subscription-1",
                expect.objectContaining({ method: "PATCH" }),
            );

            fetchMock.mockClear();
            vi.stubEnv("CURRENT_URL_ORIGIN", "http://localhost:3000");
            await graph.refreshChatbotWebhook();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] CURRENT_URL_ORIGIN is not set or is a localhost URL.",
            );
        });

        it("skips refresh when its subscription ID or persistent state is missing", async () => {
            const graph = await importPlugin();

            await graph.refreshChatbotWebhook();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] Webhook ID or persistent webhook state is not configured.",
            );
        });

        it("skips refresh when the subscription ID exists but persistent state is absent", async () => {
            vi.stubEnv("MICROSOFT_WEBHOOK_ID", "subscription-1");
            const graph = await importPlugin();

            await graph.refreshChatbotWebhook();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] Webhook ID or persistent webhook state is not configured.",
            );
        });

        it("catches webhook initialization failure during optional application startup", async () => {
            vi.stubEnv("CURRENT_URL_ORIGIN", "https://hackathon.example.test");
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "0123456789abcdef0123456789abcdef");
            fetchMock
                .mockResolvedValueOnce(jsonResponse({ access_token: "app-token" }))
                .mockRejectedValueOnce(new TypeError("Graph unavailable"));
            const graph = await importPlugin();

            await expect(graph.default()).resolves.toBe("app-token");
            expect(console.warn).toHaveBeenCalledWith(
                "[MS Graph] Webhook subscription initialization failed",
                expect.any(TypeError),
            );
        });

        it("returns the current webhook state and ID accessors", async () => {
            vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "0123456789abcdef0123456789abcdef");
            vi.stubEnv("MICROSOFT_WEBHOOK_ID", "subscription-1");
            const graph = await importPlugin();

            expect(graph.getMicrosoftWebhookState()).toBe("0123456789abcdef0123456789abcdef");
            expect(graph.getChatbotWebhookId()).toBe("subscription-1");
        });
    });
});
