import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
    render: undefined as undefined | ((html: any, context: any) => void),
}));

vi.mock("nuxt/server", () => ({
    useServerHooks: () => ({
        hook: (_name: string, handler: (html: any, context: any) => void) => {
            hookState.render = handler;
        },
    }),
}));

const baseline = () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BASIS_AUTH_COOKIE_SECRET", "x".repeat(32));
    vi.stubEnv("BASIS_AUTH_ISSUER", "https://auth.example.test");
    vi.stubEnv("BASIS_AUTH_CLIENT_ID", "client");
    vi.stubEnv("BASIS_AUTH_CLIENT_SECRET", "secret");
    vi.stubEnv("BASIS_AUTH_RESOURCE", "resource");
    vi.stubEnv("CURRENT_URL_ORIGIN", "https://site.example.test");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("MICROSOFT_TENANT_ID", "");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "");
};

describe("environment validation plugin", () => {
    beforeEach(() => {
        vi.stubGlobal("defineNitroPlugin", (plugin: () => void) => plugin);
        baseline();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    const runPlugin = async () =>
        (await import("~~/server/plugins/validate-environment")).default();
    const expectExit = async () => {
        vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process exit");
        }) as never);
        await expect(runPlugin()).rejects.toThrow("process exit");
    };

    it("warns in development for missing and short secrets and incomplete auth configuration", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("BASIS_AUTH_COOKIE_SECRET", "é".repeat(15));
        vi.stubEnv("BASIS_AUTH_CLIENT_ID", "");

        await runPlugin();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("only 30 bytes"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("BASIS_AUTH_CLIENT_ID"));
    });

    it("warns when a development cookie secret is absent", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("BASIS_AUTH_COOKIE_SECRET", "");

        await runPlugin();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("is not set"));
    });

    it("rejects a missing production cookie secret", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("BASIS_AUTH_COOKIE_SECRET", "");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expectExit();

        expect(error).toHaveBeenCalledWith(
            expect.stringContaining("[FATAL] BASIS_AUTH_COOKIE_SECRET"),
        );
    });

    it("rejects missing production basis-auth settings", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("BASIS_AUTH_CLIENT_SECRET", "");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expectExit();

        expect(error).toHaveBeenCalledWith(expect.stringContaining("BASIS_AUTH_CLIENT_SECRET"));
    });

    it("rejects an invalid public production origin", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://site.example.test/path");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expectExit();

        expect(error).toHaveBeenCalledWith(expect.stringContaining("CURRENT_URL_ORIGIN"));
    });

    it("warns for invalid development proxy hops and rejects them in production", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("TRUSTED_PROXY_HOPS", "1x");
        await runPlugin();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("TRUSTED_PROXY_HOPS"));

        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("TRUSTED_PROXY_HOPS", "11");
        vi.spyOn(console, "error").mockImplementation(() => {});
        await expectExit();
    });

    it("warns for partial Graph settings and short webhook state in development", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("MICROSOFT_TENANT_ID", "tenant");
        vi.stubEnv("MICROSOFT_CLIENT_ID", "client");
        vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "short");

        await runPlugin();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Configured: 2/3"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("at least 32 bytes"));
    });

    it("accepts complete Graph and valid webhook configuration, and rejects short production webhook state", async () => {
        vi.stubEnv("MICROSOFT_TENANT_ID", "tenant");
        vi.stubEnv("MICROSOFT_CLIENT_ID", "client");
        vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret");
        vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "s".repeat(32));
        await runPlugin();

        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("MICROSOFT_WEBHOOK_STATE", "short");
        vi.spyOn(console, "error").mockImplementation(() => {});
        await expectExit();
    });
});

describe("CSP nonce render hook", () => {
    beforeEach(() => {
        hookState.render = undefined;
        vi.stubGlobal("defineNitroPlugin", (plugin: () => void) => plugin);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("registers a hook and leaves output alone when there is no request nonce", async () => {
        const plugin = (await import("~~/server/plugins/csp-nonce")).default;
        plugin();
        const html = { head: ["<script>head()</script>"], bodyPrepend: [], bodyAppend: [] };

        hookState.render!(html, { event: { context: {} } });

        expect(html.head).toEqual(["<script>head()</script>"]);
    });

    it("adds a nonce only to renderer scripts without an existing nonce", async () => {
        const plugin = (await import("~~/server/plugins/csp-nonce")).default;
        plugin();
        const html = {
            head: [
                "<script>head()</script>",
                '<script nonce="kept">kept()</script>',
                "<scripture>skip</scripture>",
            ],
            bodyPrepend: ["<script async>before()</script>", "<script\n>newline()</script>"],
            bodyAppend: ["<script type='module'>after()</script>", "text"],
        };

        hookState.render!(html, { event: { context: { cspNonce: "nonce-123" } } });

        expect(html.head).toEqual([
            '<script nonce="nonce-123">head()</script>',
            '<script nonce="kept">kept()</script>',
            "<scripture>skip</scripture>",
        ]);
        expect(html.bodyPrepend).toEqual([
            '<script nonce="nonce-123" async>before()</script>',
            '<script nonce="nonce-123"\n>newline()</script>',
        ]);
        expect(html.bodyAppend).toEqual([
            "<script nonce=\"nonce-123\" type='module'>after()</script>",
            "text",
        ]);
    });
});
