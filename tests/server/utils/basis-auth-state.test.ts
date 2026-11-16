import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEvent } from "./database/helpers";

const ISSUER = "https://auth.example.test";
const RESOURCE = "devconnect://nethack.bisz.dev";

let event: Awaited<ReturnType<typeof createMockEvent>>;

beforeEach(async () => {
    process.env.BASIS_AUTH_ISSUER = ISSUER;
    process.env.BASIS_AUTH_CLIENT_ID = "basishacks";
    process.env.BASIS_AUTH_CLIENT_SECRET = "secret";
    process.env.BASIS_AUTH_RESOURCE = RESOURCE;
    delete process.env.BASIS_AUTH_INTERNAL_URL;
    delete process.env.BASIS_AUTH_RESOURCE_SECRET;
    event = (await createMockEvent()) as any;
});

function seedIdentity(subject: string) {
    event.context.drizzle
        .prepare("INSERT INTO users(email, auth_issuer, auth_subject) VALUES(?, ?, ?)")
        .bind(`${subject}@example.com`, ISSUER, subject)
        .run();
}

function configureInternalApi() {
    process.env.BASIS_AUTH_INTERNAL_URL = "http://127.0.0.1:3001";
    process.env.BASIS_AUTH_RESOURCE_SECRET = "resource-secret";
}

function stubUserState(state: { disabled?: boolean; tokensValidAfter?: string | null }) {
    const fetchMock = vi.fn(
        async () =>
            new Response(JSON.stringify({ user: state }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("basis-auth access-token revocations", () => {
    it("denies a revoked jti once its valid-after time has passed", async () => {
        const { isAccessTokenRevoked, revokeAccessToken } =
            await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);

        await revokeAccessToken(event, { jti: "jti-1", validAfter: now - 1, expiresAt: now + 600 });

        await expect(isAccessTokenRevoked(event, "jti-1")).resolves.toBe(true);
        await expect(isAccessTokenRevoked(event, "jti-2")).resolves.toBe(false);
    });

    it("honours a valid-after time that is still in the future", async () => {
        const { isAccessTokenRevoked, revokeAccessToken } =
            await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);

        await revokeAccessToken(event, {
            jti: "jti-future",
            validAfter: now + 60,
            expiresAt: null,
        });

        await expect(isAccessTokenRevoked(event, "jti-future")).resolves.toBe(false);
    });

    it("keeps the earliest valid-after time across retried deliveries", async () => {
        const { isAccessTokenRevoked, revokeAccessToken } =
            await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);

        await revokeAccessToken(event, { jti: "jti-3", validAfter: now + 60, expiresAt: null });
        await revokeAccessToken(event, { jti: "jti-3", validAfter: now - 1, expiresAt: now + 600 });

        await expect(isAccessTokenRevoked(event, "jti-3")).resolves.toBe(true);
    });
});

describe("basis-auth subject state", () => {
    it("rejects tokens issued at or before a local logout barrier", async () => {
        const { assertAccessTokenActive, endBasisAuthSubjectSessions } =
            await import("~~/server/utils/basis-auth-state");
        seedIdentity("subject-1");
        await endBasisAuthSubjectSessions(event, "subject-1");

        const barrier = Math.floor(Date.now() / 1000);
        await expect(
            assertAccessTokenActive(event, { sub: "subject-1", iat: barrier - 60, jti: "a" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        await expect(
            assertAccessTokenActive(event, { sub: "subject-1", iat: barrier + 1, jti: "b" }),
        ).resolves.toBeUndefined();
    });

    it("rejects revoked jti values before any other state lookup", async () => {
        const { assertAccessTokenActive, revokeAccessToken } =
            await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        await revokeAccessToken(event, { jti: "revoked", validAfter: now - 1, expiresAt: null });

        await expect(
            assertAccessTokenActive(event, { sub: "subject-2", iat: now, jti: "revoked" }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects disabled users and tokens older than the basis-auth barrier", async () => {
        configureInternalApi();
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        const barrier = new Date((now - 30) * 1000).toISOString();

        stubUserState({ disabled: true });
        await expect(
            assertAccessTokenActive(event, { sub: "disabled", iat: now, jti: "c" }),
        ).rejects.toMatchObject({ statusCode: 401 });

        stubUserState({ disabled: false, tokensValidAfter: barrier });
        await expect(
            assertAccessTokenActive(event, { sub: "barrier", iat: now - 60, jti: "d" }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("accepts an active user and caches the lookup", async () => {
        configureInternalApi();
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        const fetchMock = stubUserState({ disabled: false, tokensValidAfter: null });

        await expect(
            assertAccessTokenActive(event, { sub: "active", iat: now, jti: "e" }),
        ).resolves.toBeUndefined();
        await expect(
            assertAccessTokenActive(event, { sub: "active", iat: now, jti: "f" }),
        ).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the basis-auth internal listener is unreachable", async () => {
        configureInternalApi();
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "production");
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("connect ECONNREFUSED");
            }),
        );

        await expect(
            assertAccessTokenActive(event, { sub: "unreachable", iat: now, jti: "g" }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("fails closed on a non-404 user-state response and backs off", async () => {
        configureInternalApi();
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://hacks.example.test");
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            assertAccessTokenActive(event, { sub: "unavailable", iat: now, jti: "i" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        await expect(
            assertAccessTokenActive(event, { sub: "unavailable", iat: now, jti: "j" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("treats an unknown subject as definitive and retries on the next request", async () => {
        configureInternalApi();
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://hacks.example.test");
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            assertAccessTokenActive(event, { sub: "missing", iat: now, jti: "k" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        await expect(
            assertAccessTokenActive(event, { sub: "missing", iat: now, jti: "l" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("honours a Date-valued barrier returned by the private listener", async () => {
        configureInternalApi();
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "development");
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    ({
                        ok: true,
                        body: null,
                        json: async () => ({
                            user: {
                                disabled: false,
                                tokensValidAfter: new Date((now - 30) * 1000),
                            },
                        }),
                    }) as unknown as Response,
            ),
        );

        await expect(
            assertAccessTokenActive(event, { sub: "dated", iat: now - 60, jti: "m" }),
        ).rejects.toMatchObject({ statusCode: 401 });
        await expect(
            assertAccessTokenActive(event, { sub: "dated", iat: now, jti: "n" }),
        ).resolves.toBeUndefined();
    });

    it("keeps a loopback instance usable when the remote listener is not routable", async () => {
        configureInternalApi();
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("CURRENT_URL_ORIGIN", "http://localhost:3000");
        const { assertAccessTokenActive } = await import("~~/server/utils/basis-auth-state");
        const now = Math.floor(Date.now() / 1000);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("connect ECONNREFUSED");
            }),
        );

        await expect(
            assertAccessTokenActive(event, { sub: "unreachable", iat: now, jti: "h" }),
        ).resolves.toBeUndefined();
    });
});
