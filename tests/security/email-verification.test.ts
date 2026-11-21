import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidc = vi.hoisted(() => ({
    discovery: vi.fn(),
    ClientSecretBasic: vi.fn(() => "client-auth"),
    allowInsecureRequests: vi.fn(),
    authorizationCodeGrant: vi.fn(),
    fetchUserInfo: vi.fn(),
}));

vi.mock("openid-client", () => oidc);
vi.mock("~~/server/utils/oauth2", () => ({
    getPublicOrigin: () => "https://hacks.example.test",
}));

import { completeBasisAuthFlow } from "~~/server/utils/basis-auth";

const transaction = () => ({
    state: "state",
    nonce: "nonce",
    codeVerifier: "verifier",
    startedAt: Date.now(),
});

function emailUserInfo(emailVerified: unknown) {
    return {
        email: "person@example.test",
        ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.BASIS_AUTH_ISSUER = "https://auth.example.test";
    process.env.BASIS_AUTH_CLIENT_ID = "basishacks";
    process.env.BASIS_AUTH_CLIENT_SECRET = "secret";
    process.env.BASIS_AUTH_RESOURCE = "devconnect://nethack.bisz.dev";
    oidc.discovery.mockResolvedValue("configuration");
    oidc.authorizationCodeGrant.mockResolvedValue({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 300,
        claims: () => ({ sub: "subject-1" }),
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.REQUIRE_VERIFIED_EMAIL;
});

describe("email verification policy", () => {
    it("accepts an omitted claim by default", async () => {
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(undefined));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).resolves.toMatchObject({ identity: { email: "person@example.test" } });
    });

    it("rejects an explicitly unverified address by default", async () => {
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(false));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).rejects.toThrow("did not verify the email address");
    });

    it("accepts a verified address by default", async () => {
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(true));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).resolves.toMatchObject({ identity: { email: "person@example.test" } });
    });

    it("rejects an omitted claim when REQUIRE_VERIFIED_EMAIL is enabled", async () => {
        vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "true");
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(undefined));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).rejects.toThrow("did not verify the email address");
    });

    it("rejects a non-boolean claim when REQUIRE_VERIFIED_EMAIL is enabled", async () => {
        vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "1");
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo("yes"));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).rejects.toThrow("did not verify the email address");
    });

    it("accepts a verified address when REQUIRE_VERIFIED_EMAIL is enabled", async () => {
        vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "on");
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(true));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).resolves.toMatchObject({ identity: { email: "person@example.test" } });
    });

    it("keeps the default policy when the flag is explicitly off", async () => {
        vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "0");
        oidc.fetchUserInfo.mockResolvedValue(emailUserInfo(undefined));

        await expect(
            completeBasisAuthFlow(new URL("https://hacks.example.test/callback"), transaction()),
        ).resolves.toMatchObject({ identity: { email: "person@example.test" } });
    });
});
