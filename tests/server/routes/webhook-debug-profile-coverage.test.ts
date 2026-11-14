import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: {} as Record<string, unknown>,
    jsonBody: null as any,
    webhookState: "webhook-secret",
    stateValid: true,
    user: null as any,
    profileAsset: { stream: { profile: true }, size: 23 } as any,
    uploadResult: {
        filename: "photo.png",
        relativePath: "uploads/photo.png",
        referenceId: "3e45b75f-8a46-4b98-b3dc-a6ad84955e45",
    },
    storedNames: vi.fn(async (collection: string, path?: string) => [
        `${collection}:${path ?? "root"}`,
    ]),
    readLimitedJsonBody: vi.fn(async () => mocks.jsonBody),
    hasValidMicrosoftWebhookState: vi.fn(() => mocks.stateValid),
    getMicrosoftWebhookState: vi.fn(() => mocks.webhookState),
    getChatbotWebhookId: vi.fn(() => "subscription-1"),
    refreshChatbotWebhook: vi.fn(async () => undefined),
    requireUser: vi.fn(async () => ({ id: 9 })),
    enforceSameOriginCookieRequest: vi.fn(),
    storeMultipartAsset: vi.fn(async () => mocks.uploadResult),
    assetContentType: vi.fn((path: string) =>
        path.endsWith(".png") ? "image/png" : "application/octet-stream",
    ),
    openStoredAsset: vi.fn(async () => mocks.profileAsset),
    sendStream: vi.fn((_event: unknown, stream: unknown) => ({ streamed: stream })),
}));

vi.mock("~~/server/plugins/microsoft", () => ({
    getChatbotWebhookId: mocks.getChatbotWebhookId,
    getMicrosoftWebhookState: mocks.getMicrosoftWebhookState,
    refreshChatbotWebhook: mocks.refreshChatbotWebhook,
}));
vi.mock("~~/server/utils/limited-json-body", () => ({
    readLimitedJsonBody: mocks.readLimitedJsonBody,
}));
vi.mock("~~/server/utils/microsoft-webhook-security", () => ({
    hasValidMicrosoftWebhookState: mocks.hasValidMicrosoftWebhookState,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: any) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
    UPLOAD_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/request-security", () => ({
    enforceSameOriginCookieRequest: mocks.enforceSameOriginCookieRequest,
}));
vi.mock("~~/server/utils/multipart-upload", () => ({
    storeMultipartAsset: mocks.storeMultipartAsset,
}));
vi.mock("~~/server/utils/assets", () => ({
    getStoredAssetNames: mocks.storedNames,
    assetContentType: mocks.assetContentType,
    openStoredAsset: mocks.openStoredAsset,
}));
vi.mock("h3", () => ({ sendStream: mocks.sendStream }));

describe("Microsoft webhook route actions", () => {
    let update: (event: any) => Promise<any>;
    let lifecycle: (event: any) => Promise<any>;
    let event: any;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: any) => handler);
        vi.stubGlobal("getValidatedQuery", (_event: unknown, validate: (query: unknown) => any) => {
            try {
                return validate(mocks.query);
            } catch (error) {
                throw Object.assign(error as Error, { statusCode: 400 });
            }
        });
        vi.stubGlobal("setResponseHeader", (target: any, name: string, value: string) => {
            target.headers[name] = value;
        });
        vi.stubGlobal("setResponseStatus", (target: any, status: number) => {
            target.status = status;
        });
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.message ?? error.statusMessage), {
                ...error,
                statusCode: error.statusCode ?? error.status,
            }),
        );
        mocks.query = {};
        mocks.jsonBody = null;
        mocks.webhookState = "webhook-secret";
        mocks.stateValid = true;
        mocks.readLimitedJsonBody.mockClear();
        mocks.hasValidMicrosoftWebhookState.mockClear();
        mocks.getMicrosoftWebhookState.mockClear();
        mocks.refreshChatbotWebhook.mockReset().mockResolvedValue(undefined);
        event = { headers: {} };
        update = (await import("~~/server/api/_webhooks/update.post")).default;
        lifecycle = (await import("~~/server/api/_webhooks/lifecycle.post")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([
        ["missing", null],
        ["object", { value: {} }],
        ["empty array", { value: [] }],
    ])("rejects %s update payloads", async (_label, body) => {
        mocks.jsonBody = body;
        await expect(update(event)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("echoes Graph validation tokens as plain text without reading a body", async () => {
        mocks.query = { validationToken: "verify-me" };

        await expect(update(event)).resolves.toBe("verify-me");

        expect(event.status).toBe(200);
        expect(event.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
        expect(mocks.readLimitedJsonBody).not.toHaveBeenCalled();
    });

    it("rejects repeated or oversized validation tokens", async () => {
        mocks.query = { validationToken: ["first", "second"] };
        await expect(update(event)).rejects.toMatchObject({ statusCode: 400 });

        mocks.query = { validationToken: "x".repeat(4097) };
        await expect(lifecycle(event)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.readLimitedJsonBody).not.toHaveBeenCalled();
    });

    it.each([
        ["missing client state", { value: [{ changeType: "updated" }] }],
        ["non-string client state", { value: [{ clientState: ["invalid"] }] }],
        ["invalid change type", { value: [{ clientState: "webhook-secret", changeType: 4 }] }],
    ])("rejects malformed update notification fields: %s", async (_label, body) => {
        mocks.jsonBody = body;
        await expect(update(event)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.hasValidMicrosoftWebhookState).not.toHaveBeenCalled();
    });

    it("rejects update notifications with an invalid client state", async () => {
        mocks.jsonBody = { value: [{ clientState: "wrong" }] };
        mocks.stateValid = false;

        await expect(update(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.hasValidMicrosoftWebhookState).toHaveBeenCalledWith(
            mocks.jsonBody.value,
            "webhook-secret",
        );
    });

    it("accepts a validated update notification and reports the received change", async () => {
        mocks.jsonBody = {
            value: [{ clientState: "webhook-secret", changeType: "updated", resource: "users/1" }],
        };

        await expect(update(event)).resolves.toEqual({ message: "Received" });

        expect(event.status).toBe(200);
        expect(mocks.readLimitedJsonBody).toHaveBeenCalledWith(event, 64 * 1024);
    });

    it.each([
        ["missing", null],
        ["object", { value: {} }],
        ["empty array", { value: [] }],
    ])("rejects %s lifecycle payloads", async (_label, body) => {
        mocks.jsonBody = body;
        await expect(lifecycle(event)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("echoes Graph validation tokens for lifecycle subscriptions", async () => {
        mocks.query = { validationToken: "lifecycle-check" };

        await expect(lifecycle(event)).resolves.toBe("lifecycle-check");

        expect(event.status).toBe(200);
        expect(event.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    });

    it("rejects lifecycle events with an invalid client state", async () => {
        mocks.jsonBody = { value: [{ clientState: "wrong" }] };
        mocks.stateValid = false;

        await expect(lifecycle(event)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("queues refresh for reauthorization requests and returns 202", async () => {
        mocks.jsonBody = {
            value: [{ clientState: "webhook-secret", lifecycleEvent: "reauthorizationRequired" }],
        };

        await expect(lifecycle(event)).resolves.toEqual({ message: "Received" });
        await Promise.resolve();

        expect(mocks.refreshChatbotWebhook).toHaveBeenCalledOnce();
        expect(event.status).toBe(202);
    });

    it("logs a failed webhook refresh without failing the accepted lifecycle request", async () => {
        const error = new Error("refresh unavailable");
        const logError = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.refreshChatbotWebhook.mockRejectedValue(error);
        mocks.jsonBody = {
            value: [{ clientState: "webhook-secret", lifecycleEvent: "reauthorizationRequired" }],
        };

        await expect(lifecycle(event)).resolves.toEqual({ message: "Received" });
        await vi.waitFor(() =>
            expect(logError).toHaveBeenCalledWith(
                "[MS Graph] Failed to refresh chatbot webhook:",
                error,
            ),
        );
    });

    it("accepts other valid lifecycle events without refreshing the subscription", async () => {
        mocks.jsonBody = { value: [{ clientState: "webhook-secret", lifecycleEvent: "missed" }] };

        await expect(lifecycle(event)).resolves.toEqual({ message: "Received" });

        expect(mocks.refreshChatbotWebhook).not.toHaveBeenCalled();
        expect(event.status).toBe(202);
    });
});

describe("debug asset actions", () => {
    let upload: (event: any) => Promise<any>;
    let files: (event: any) => Promise<any>;
    let event: any;
    let mode: unknown;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: any) => handler);
        vi.stubGlobal("getValidatedQuery", (_event: unknown, validate: (query: unknown) => any) => {
            try {
                return validate({ mode });
            } catch (error) {
                throw Object.assign(error as Error, { statusCode: 400 });
            }
        });
        vi.stubGlobal("getHeader", (_event: any, name: string) => {
            expect(name).toBe("content-type");
            return "multipart/form-data; boundary=test";
        });
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.message ?? error.statusMessage), {
                ...error,
                statusCode: error.statusCode ?? error.status,
            }),
        );
        mode = "static";
        event = { node: { req: { body: "multipart" } }, context: { drizzle: {} } };
        mocks.requireUser.mockReset().mockResolvedValue({ id: 9 });
        mocks.enforceSameOriginCookieRequest.mockReset();
        mocks.storeMultipartAsset.mockReset().mockResolvedValue(mocks.uploadResult);
        mocks.storedNames.mockClear();
        upload = (await import("~~/server/api/debug/upload.post")).default;
        files = (await import("~~/server/api/debug/files.get")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it("rejects invalid upload modes before authorization or parsing", async () => {
        mode = "other";

        await expect(upload(event)).rejects.toMatchObject({ statusCode: 400 });

        expect(mocks.enforceSameOriginCookieRequest).not.toHaveBeenCalled();
        expect(mocks.requireUser).not.toHaveBeenCalled();
    });

    it.each([
        ["static", "/assets/uploads/photo.png", "assets"],
        ["user", "/userast/photo.png", "userassets"],
    ])(
        "stores a %s upload and returns its permalink",
        async (uploadMode, permalink, collection) => {
            mode = uploadMode;

            await expect(upload(event)).resolves.toEqual({
                permalink,
                referenceId: mocks.uploadResult.referenceId,
            });

            expect(mocks.enforceSameOriginCookieRequest).toHaveBeenCalledWith(event);
            expect(mocks.requireUser).toHaveBeenCalledWith(event, "nethack.Debug.filesWrite");
            expect(mocks.storeMultipartAsset).toHaveBeenCalledWith(
                event.node.req,
                "multipart/form-data; boundary=test",
                collection,
                { database: event.context.drizzle, createdBy: 9 },
            );
        },
    );

    it("fails closed when the storage layer cannot register an uploaded reference", async () => {
        mocks.storeMultipartAsset.mockResolvedValueOnce({
            filename: "photo.png",
            relativePath: "uploads/photo.png",
        } as any);

        await expect(upload(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Unable to register asset reference",
        });
    });

    it("stops uploads when same-origin protection rejects the request", async () => {
        const failure = new Error("origin rejected");
        mocks.enforceSameOriginCookieRequest.mockImplementation(() => {
            throw failure;
        });

        await expect(upload(event)).rejects.toBe(failure);
        expect(mocks.requireUser).not.toHaveBeenCalled();
        expect(mocks.storeMultipartAsset).not.toHaveBeenCalled();
    });

    it("stops uploads when permission authorization rejects the user", async () => {
        const failure = new Error("forbidden");
        mocks.requireUser.mockRejectedValue(failure);

        await expect(upload(event)).rejects.toBe(failure);
        expect(mocks.storeMultipartAsset).not.toHaveBeenCalled();
    });

    it("returns both asset collections after read permission is granted", async () => {
        await expect(files(event)).resolves.toEqual({
            assets: ["assets:uploads"],
            userast: ["userassets:root"],
        });

        expect(mocks.requireUser).toHaveBeenCalledWith(event, "nethack.Debug.filesRead");
        expect(mocks.storedNames).toHaveBeenNthCalledWith(1, "assets", "uploads");
        expect(mocks.storedNames).toHaveBeenNthCalledWith(2, "userassets");
    });

    it("does not enumerate assets without read permission", async () => {
        const failure = new Error("forbidden");
        mocks.requireUser.mockRejectedValue(failure);

        await expect(files(event)).rejects.toBe(failure);
        expect(mocks.storedNames).not.toHaveBeenCalled();
    });
});

describe("profile picture route", () => {
    let handler: (event: any) => Promise<any>;
    let event: any;
    let id: string;

    beforeEach(async () => {
        vi.stubGlobal("defineEventHandler", (handler: any) => handler);
        vi.stubGlobal("getValidatedRouterParams", async () => ({ id }));
        vi.stubGlobal(
            "getUser",
            vi.fn(async () => mocks.user),
        );
        vi.stubGlobal("setResponseHeader", (target: any, name: string, value: unknown) => {
            target.headers[name] = value;
        });
        vi.stubGlobal("createError", (error: any) =>
            Object.assign(new Error(error.message ?? error.statusMessage), {
                ...error,
                statusCode: error.statusCode ?? error.status,
            }),
        );
        id = "1";
        event = { headers: {} };
        mocks.user = null;
        mocks.openStoredAsset.mockReset().mockResolvedValue(mocks.profileAsset);
        mocks.assetContentType.mockClear();
        mocks.sendStream.mockClear();
        handler = (await import("~~/server/api/users/[id]/profile_picture.get")).default;
    });

    afterEach(() => vi.unstubAllGlobals());

    it("returns not found for an unknown user", async () => {
        await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect((globalThis as any).getUser).toHaveBeenCalledWith(event, 1);
    });

    it("streams the stored profile image with private safety headers", async () => {
        mocks.user = {
            id: 1,
            email: "person@example.test",
            profile_picture: "profiles/person.png",
        };

        await expect(handler(event)).resolves.toEqual({ streamed: mocks.profileAsset.stream });

        expect(mocks.openStoredAsset).toHaveBeenCalledWith("userassets", "profiles/person.png");
        expect(event.headers).toEqual({
            "Content-Type": "image/png",
            "Content-Length": 23,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        expect(mocks.sendStream).toHaveBeenCalledWith(event, mocks.profileAsset.stream);
    });

    it("generates an identicon when no profile image is stored", async () => {
        mocks.user = { id: 1, email: "person@example.test", profile_picture: null };

        const response = await handler(event);
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));

        expect(Buffer.concat(chunks).subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(event.headers).toEqual({
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        });
        expect(mocks.openStoredAsset).not.toHaveBeenCalled();
    });
});
