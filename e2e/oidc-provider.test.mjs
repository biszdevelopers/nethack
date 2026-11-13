import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { after, before, test } from "node:test";
import * as oidc from "openid-client";
import { startOidcTestProvider } from "./oidc-provider.mjs";
import { validateE2eConfiguration } from "./start-server.mjs";

const clientId = "basishacks-e2e-client";
const clientSecret = randomBytes(32).toString("base64url");
const resource = "devconnect://nethack.bisz.dev";
const appOrigin = "http://127.0.0.1:24680";
const testIdentity = {
    sub: "e2e-judge-7",
    email: "judge@e2e.basishacks.invalid",
    name: "Judge Fixture",
    permissions: ["judge"],
};

let provider;

before(async () => {
    provider = await startOidcTestProvider({
        clientId,
        clientSecret,
        resource,
        appOrigin,
        users: [testIdentity],
    });
});

after(async () => {
    await provider?.close();
});

function createVerifier() {
    return randomBytes(32).toString("base64url");
}

async function authorize({
    redirectUri = `${appOrigin}/api/auth/basis/callback`,
    consentOrigin = provider.issuer,
    submitConsent = true,
} = {}) {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = createVerifier();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationUrl = new URL(`${provider.issuer}/authorize`);
    authorizationUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid profile email offline_access nethack.access",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource,
    }).toString();

    const consentPage = await fetch(authorizationUrl);
    const consentHtml = await consentPage.text();
    if (!consentPage.ok) return { consentPage, consentHtml, state, nonce, verifier };

    const ticket = /name="ticket" value="([A-Za-z0-9_-]+)"/.exec(consentHtml)?.[1];
    assert.ok(ticket, "authorization page should contain its opaque consent ticket");
    if (!submitConsent) return { consentPage, consentHtml, ticket, state, nonce, verifier };

    const consent = await submitConsentTicket(ticket, { origin: consentOrigin });
    return { consentPage, consentHtml, ticket, consent, state, nonce, verifier };
}

async function submitConsentTicket(
    ticket,
    { origin, subject = testIdentity.sub, duplicateTicket = false, duplicateSubject = false } = {},
) {
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    if (origin !== undefined) headers.Origin = origin;

    const body = new URLSearchParams();
    body.append("ticket", ticket);
    if (duplicateTicket) body.append("ticket", ticket);
    body.append("sub", subject);
    if (duplicateSubject) body.append("sub", subject);

    return await fetch(`${provider.issuer}/authorize/consent`, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
    });
}

function clientAuthorization() {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function exchangeAuthorizationCode(flow, { verifier = flow.verifier } = {}) {
    const location = flow.consent.headers.get("location");
    assert.ok(location, "successful consent should return the registered callback URL");
    const callback = new URL(location);
    const response = await fetch(`${provider.issuer}/token`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: callback.searchParams.get("code"),
            redirect_uri: `${appOrigin}/api/auth/basis/callback`,
            code_verifier: verifier,
            resource,
        }),
    });
    return { response, callback };
}

async function readAndVerifyJwt(token, jwk, expectedType) {
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    assert.equal(header.alg, "RS256");
    assert.equal(header.typ, expectedType);
    assert.equal(
        verify(
            "RSA-SHA256",
            Buffer.from(`${parts[0]}.${parts[1]}`),
            createPublicKey({ key: jwk, format: "jwk" }),
            Buffer.from(parts[2], "base64url"),
        ),
        true,
    );
    return payload;
}

test("serves discovery metadata and a public-only signing key on loopback", async () => {
    assert.equal(new URL(provider.issuer).hostname, "127.0.0.1");

    const metadataResponse = await fetch(`${provider.issuer}/.well-known/openid-configuration`);
    assert.equal(metadataResponse.status, 200);
    assert.equal(metadataResponse.headers.get("cache-control"), "no-store");
    const metadata = await metadataResponse.json();
    assert.equal(metadata.issuer, provider.issuer);
    assert.equal(metadata.authorization_endpoint, `${provider.issuer}/authorize`);
    assert.equal(metadata.token_endpoint, `${provider.issuer}/token`);
    assert.equal(metadata.userinfo_endpoint, `${provider.issuer}/userinfo`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);

    const jwksResponse = await fetch(metadata.jwks_uri);
    const jwks = await jwksResponse.json();
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0].alg, "RS256");
    assert.equal(jwks.keys[0].use, "sig");
    assert.equal("d" in jwks.keys[0], false);
    assert.equal("p" in jwks.keys[0], false);
});

test("interoperates with the application's OpenID client discovery, code exchange, and UserInfo", async () => {
    const configuration = await oidc.discovery(
        new URL(provider.issuer),
        clientId,
        {
            client_secret: clientSecret,
            token_endpoint_auth_method: "client_secret_basic",
        },
        oidc.ClientSecretBasic(clientSecret),
        { execute: [oidc.allowInsecureRequests] },
    );
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = createVerifier();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: `${appOrigin}/api/auth/basis/callback`,
        response_type: "code",
        scope: "openid profile email offline_access nethack.access",
        resource,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
    });

    const consentPage = await fetch(authorizationUrl);
    const consentHtml = await consentPage.text();
    assert.equal(consentPage.status, 200);
    const ticket = /name="ticket" value="([A-Za-z0-9_-]+)"/.exec(consentHtml)?.[1];
    assert.ok(ticket);
    const consent = await fetch(`${provider.issuer}/authorize/consent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: provider.issuer,
        },
        body: new URLSearchParams({ ticket, sub: testIdentity.sub }),
        redirect: "manual",
    });
    assert.equal(consent.status, 302);
    const callback = new URL(consent.headers.get("location"));

    const tokens = await oidc.authorizationCodeGrant(
        configuration,
        new URL(callback.pathname + callback.search, appOrigin),
        {
            pkceCodeVerifier: verifier,
            expectedState: state,
            expectedNonce: nonce,
        },
    );
    assert.equal(tokens.claims()?.sub, testIdentity.sub);
    assert.equal(tokens.claims()?.email, testIdentity.email);
    assert.equal(tokens.claims()?.email_verified, true);

    const userInfo = await oidc.fetchUserInfo(configuration, tokens.access_token, testIdentity.sub);
    assert.equal(userInfo.sub, testIdentity.sub);
    assert.equal(userInfo.email, testIdentity.email);
    assert.equal(userInfo.email_verified, true);
});

test("performs PKCE authorization, emits nonce-bound tokens, serves UserInfo, and revokes", async () => {
    const flow = await authorize();
    assert.equal(flow.consentPage.status, 200);
    assert.match(flow.consentHtml, /Choose a test identity/);
    assert.equal(
        flow.consentPage.headers.get("content-security-policy"),
        `default-src 'none'; form-action ${provider.issuer}; base-uri 'none'; frame-ancestors 'none'`,
    );
    assert.equal(flow.consent.status, 302);

    const location = new URL(flow.consent.headers.get("location"));
    assert.equal(location.origin, appOrigin);
    assert.equal(location.pathname, "/api/auth/basis/callback");
    assert.equal(location.searchParams.get("state"), flow.state);
    assert.ok(location.searchParams.get("code"));

    const { response, callback } = await exchangeAuthorizationCode(flow);
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.scope, "openid profile email offline_access nethack.access");
    assert.ok(tokens.refresh_token);

    const jwks = await (await fetch(`${provider.issuer}/oauth/jwks`)).json();
    const idClaims = await readAndVerifyJwt(tokens.id_token, jwks.keys[0], "JWT");
    assert.equal(idClaims.iss, provider.issuer);
    assert.equal(idClaims.aud, clientId);
    assert.equal(idClaims.sub, testIdentity.sub);
    assert.equal(idClaims.nonce, flow.nonce);
    assert.equal(idClaims.email, testIdentity.email);
    assert.equal(idClaims.email_verified, true);
    assert.equal(idClaims.name, testIdentity.name);

    const accessClaims = await readAndVerifyJwt(tokens.access_token, jwks.keys[0], "at+jwt");
    assert.equal(accessClaims.iss, provider.issuer);
    assert.equal(accessClaims.aud, resource);
    assert.equal(accessClaims.sub, testIdentity.sub);
    assert.deepEqual(accessClaims.permissions, ["judge"]);

    const userInfoResponse = await fetch(`${provider.issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(userInfoResponse.status, 200);
    assert.deepEqual(await userInfoResponse.json(), {
        sub: testIdentity.sub,
        email: testIdentity.email,
        email_verified: true,
        name: testIdentity.name,
    });

    const replay = await fetch(`${provider.issuer}/token`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: callback.searchParams.get("code"),
            redirect_uri: `${appOrigin}/api/auth/basis/callback`,
            code_verifier: flow.verifier,
        }),
    });
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: "invalid_grant" });

    const refreshResponse = await fetch(`${provider.issuer}/token`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
        }),
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json();
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

    const revokeResponse = await fetch(`${provider.issuer}/revoke`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            token: refreshed.access_token,
            token_type_hint: "access_token",
        }),
    });
    assert.equal(revokeResponse.status, 200);
    const revokedUserInfo = await fetch(`${provider.issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${refreshed.access_token}` },
    });
    assert.equal(revokedUserInfo.status, 401);

    const revokeRefresh = await fetch(`${provider.issuer}/revoke`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: refreshed.refresh_token }),
    });
    assert.equal(revokeRefresh.status, 200);
});

test("accepts an opaque consent origin only with a valid single-use ticket", async () => {
    const flow = await authorize({ consentOrigin: "null" });
    assert.equal(flow.consentPage.status, 200);
    assert.equal(flow.consent.status, 302);

    const replay = await submitConsentTicket(flow.ticket, { origin: "null" });

    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: "invalid_request" });
});

test("rejects unknown, expired, and duplicate consent ticket fields for opaque origins", async () => {
    const unknown = await submitConsentTicket("unknown-ticket", { origin: "null" });
    assert.equal(unknown.status, 400);

    const duplicateFlow = await authorize({ submitConsent: false });
    const duplicateTicket = await submitConsentTicket(duplicateFlow.ticket, {
        origin: "null",
        duplicateTicket: true,
    });
    assert.equal(duplicateTicket.status, 400);
    const duplicateSubject = await submitConsentTicket(duplicateFlow.ticket, {
        origin: "null",
        duplicateSubject: true,
    });
    assert.equal(duplicateSubject.status, 400);
    const usableAfterMalformedForms = await submitConsentTicket(duplicateFlow.ticket, {
        origin: "null",
    });
    assert.equal(usableAfterMalformedForms.status, 302);

    const expiredFlow = await authorize({ submitConsent: false });
    const currentDateNow = Date.now;
    Date.now = () => currentDateNow() + 6 * 60 * 1000;
    try {
        const expired = await submitConsentTicket(expiredFlow.ticket, { origin: "null" });
        assert.equal(expired.status, 400);
    } finally {
        Date.now = currentDateNow;
    }
});

test("consumes opaque-origin consent tickets after invalid identities and concurrent redemption", async () => {
    const invalidIdentityFlow = await authorize({ submitConsent: false });
    const invalidIdentity = await submitConsentTicket(invalidIdentityFlow.ticket, {
        origin: "null",
        subject: "unknown-user",
    });
    assert.equal(invalidIdentity.status, 400);
    const consumedTicket = await submitConsentTicket(invalidIdentityFlow.ticket, {
        origin: "null",
    });
    assert.equal(consumedTicket.status, 400);

    const concurrentFlow = await authorize({ submitConsent: false });
    const redemptions = await Promise.all([
        submitConsentTicket(concurrentFlow.ticket, { origin: "null" }),
        submitConsentTicket(concurrentFlow.ticket, { origin: "null" }),
    ]);
    assert.deepEqual(redemptions.map((response) => response.status).sort(), [302, 400]);
});

test("rejects non-loopback callbacks, failed PKCE, missing consent origin, and bad client credentials", async () => {
    const invalidCallback = await authorize({ redirectUri: "https://attacker.invalid/callback" });
    assert.equal(invalidCallback.consentPage.status, 400);
    assert.deepEqual(JSON.parse(invalidCallback.consentHtml), { error: "invalid_request" });

    const crossOriginConsentPage = await fetch(`${provider.issuer}/authorize?client_id=wrong`);
    assert.equal(crossOriginConsentPage.status, 400);

    const flow = await authorize({ submitConsent: false });
    const noOrigin = await submitConsentTicket(flow.ticket);
    assert.equal(noOrigin.status, 403);
    const foreignOrigin = await submitConsentTicket(flow.ticket, {
        origin: "https://attacker.invalid",
    });
    assert.equal(foreignOrigin.status, 403);
    const validOrigin = await submitConsentTicket(flow.ticket, { origin: provider.issuer });
    assert.equal(validOrigin.status, 302);

    const nextFlow = await authorize();
    const wrongVerifier = `${nextFlow.verifier.slice(0, -1)}${
        nextFlow.verifier.endsWith("A") ? "B" : "A"
    }`;
    const failedExchange = await exchangeAuthorizationCode(nextFlow, { verifier: wrongVerifier });
    assert.equal(failedExchange.response.status, 400);
    assert.deepEqual(await failedExchange.response.json(), { error: "invalid_grant" });

    const unauthorized = await fetch(`${provider.issuer}/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:wrong-secret`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "unknown" }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), 'Basic realm="e2e-oidc"');

    const mismatchedBodyClient = await fetch(`${provider.issuer}/token`, {
        method: "POST",
        headers: {
            Authorization: clientAuthorization(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: "another-client",
            grant_type: "refresh_token",
            refresh_token: "unknown",
        }),
    });
    assert.equal(mismatchedBodyClient.status, 401);
    assert.deepEqual(await mismatchedBodyClient.json(), { error: "invalid_client" });
});

test("validates configuration so the provider cannot bind to a public app origin", async () => {
    await assert.rejects(
        startOidcTestProvider({
            clientId,
            clientSecret,
            resource,
            appOrigin: "https://basishacks.example.com",
            users: [testIdentity],
        }),
        /HTTP loopback origin/,
    );
});

test("accepts only an explicitly opted-in E2E database on numeric loopback with the exact test name", () => {
    const config = validateE2eConfiguration({
        BASISHACKS_E2E: "1",
        DATABASE_URL: "postgresql://e2e:secret@127.0.0.1:5432/basishacks_e2e",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3005",
    });
    assert.equal(config.appOrigin, "http://127.0.0.1:3005");
    assert.equal(new URL(config.databaseUrl).pathname, "/basishacks_e2e");
});

test("rejects remote databases and non-test database names before starting the app", () => {
    const base = {
        BASISHACKS_E2E: "1",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3005",
    };
    assert.throws(
        () =>
            validateE2eConfiguration({
                ...base,
                DATABASE_URL: "postgresql://e2e:secret@database.example.com:5432/basishacks_e2e",
            }),
        /numeric loopback address/,
    );
    assert.throws(
        () =>
            validateE2eConfiguration({
                ...base,
                DATABASE_URL: "postgresql://e2e:secret@127.0.0.1:5432/basishacks_prod_e2e",
            }),
        /exactly basishacks_e2e/,
    );
    assert.throws(
        () =>
            validateE2eConfiguration({
                ...base,
                DATABASE_URL:
                    "postgresql://e2e:secret@127.0.0.1:5432/basishacks_e2e?host=database.example.com",
            }),
        /may not override.*host/,
    );
});

test("requires the E2E opt-in and a port-specific loopback app origin", () => {
    assert.throws(
        () =>
            validateE2eConfiguration({
                DATABASE_URL: "postgresql://e2e:secret@127.0.0.1:5432/basishacks_e2e",
            }),
        /explicit BASISHACKS_E2E=1 opt-in/,
    );
    assert.throws(
        () =>
            validateE2eConfiguration({
                BASISHACKS_E2E: "1",
                DATABASE_URL: "postgresql://e2e:secret@127.0.0.1:5432/basishacks_e2e",
                PLAYWRIGHT_BASE_URL: "http://127.0.0.1/",
            }),
        /explicit port/,
    );
    const safeEnvironment = {
        BASISHACKS_E2E: "1",
        DATABASE_URL: "postgresql://e2e:secret@127.0.0.1:5432/basishacks_e2e",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3005",
    };
    assert.throws(
        () => validateE2eConfiguration({ ...safeEnvironment, NITRO_HOST: "0.0.0.0" }),
        /app host must bind only to 127.0.0.1/,
    );
    assert.throws(
        () => validateE2eConfiguration({ ...safeEnvironment, HOST: "0.0.0.0" }),
        /app host must bind only to 127.0.0.1/,
    );
    assert.throws(
        () => validateE2eConfiguration({ ...safeEnvironment, NITRO_PORT: "3006" }),
        /app port must match PLAYWRIGHT_BASE_URL/,
    );
    assert.throws(
        () => validateE2eConfiguration({ ...safeEnvironment, PORT: "3006" }),
        /app port must match PLAYWRIGHT_BASE_URL/,
    );
    assert.throws(
        () =>
            validateE2eConfiguration({
                ...safeEnvironment,
                NITRO_UNIX_SOCKET: "/tmp/basishacks.sock",
            }),
        /cannot use a Unix socket/,
    );
});
