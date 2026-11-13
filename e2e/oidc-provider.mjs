import { createServer } from "node:http";
import {
    createHash,
    generateKeyPairSync,
    randomBytes,
    sign,
    timingSafeEqual,
    verify,
} from "node:crypto";

const MAX_FORM_BYTES = 8 * 1024;
const MAX_PENDING_AUTHORIZATIONS = 128;
const MAX_AUTHORIZATION_CODES = 128;
const MAX_ACCESS_TOKENS = 512;
const MAX_REFRESH_TOKENS = 256;
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 60 * 60 * 1000;
const CALLBACK_PATH = "/api/auth/basis/callback";

class ProviderError extends Error {
    constructor(statusCode, oauthError) {
        super(oauthError);
        this.statusCode = statusCode;
        this.oauthError = oauthError;
    }
}

function assertString(value, label, { min = 1, max = 512 } = {}) {
    if (typeof value !== "string" || value.length < min || value.length > max) {
        throw new TypeError(`${label} must be a string between ${min} and ${max} characters`);
    }
    return value;
}

function assertLoopbackAppOrigin(value) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new TypeError("appOrigin must be a valid HTTP loopback origin");
    }

    const loopbackHost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" ||
        parsed.hostname === "::1";
    if (
        parsed.protocol !== "http:" ||
        !loopbackHost ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
    ) {
        throw new TypeError("appOrigin must be a credential-free HTTP loopback origin");
    }
    return parsed.origin;
}

function normalizeUsers(users) {
    if (!Array.isArray(users) || users.length < 1 || users.length > 32) {
        throw new TypeError("users must contain between 1 and 32 test identities");
    }

    const subjects = new Set();
    const emails = new Set();
    return users.map((user, index) => {
        if (!user || typeof user !== "object" || Array.isArray(user)) {
            throw new TypeError(`users[${index}] must be an object`);
        }
        const subject = assertString(user.sub, `users[${index}].sub`, { max: 255 });
        const email = assertString(user.email, `users[${index}].email`, { max: 320 });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new TypeError(`users[${index}].email must be a valid email address`);
        }
        const name =
            user.name === undefined
                ? subject
                : assertString(user.name, "user name", {
                      max: 200,
                  });
        const permissions = user.permissions ?? [];
        if (
            !Array.isArray(permissions) ||
            permissions.length > 64 ||
            permissions.some((permission) => typeof permission !== "string" || !permission)
        ) {
            throw new TypeError(
                `users[${index}].permissions must be an array of non-empty strings`,
            );
        }
        if (subjects.has(subject) || emails.has(email.toLowerCase())) {
            throw new TypeError("Test identity subjects and email addresses must be unique");
        }
        subjects.add(subject);
        emails.add(email.toLowerCase());
        return Object.freeze({ sub: subject, email, name, permissions: [...permissions] });
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

function addNoStoreHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(response, statusCode, value, { basicChallenge = false } = {}) {
    addNoStoreHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (basicChallenge) response.setHeader("WWW-Authenticate", 'Basic realm="e2e-oidc"');
    response.end(JSON.stringify(value));
}

function sendHtml(response, statusCode, value) {
    addNoStoreHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.end(value);
}

function readUnique(params, name, { required = true } = {}) {
    const values = params.getAll(name);
    if (values.length === 0 && !required) return undefined;
    if (values.length !== 1 || (required && values[0] === "")) {
        throw new ProviderError(400, "invalid_request");
    }
    return values[0];
}

async function readForm(request) {
    const contentType = String(request.headers["content-type"] ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") {
        throw new ProviderError(400, "invalid_request");
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_FORM_BYTES) throw new ProviderError(413, "invalid_request");
        chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function equalSecret(actual, expected) {
    const actualDigest = createHash("sha256").update(actual).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();
    return timingSafeEqual(actualDigest, expectedDigest) && actual.length === expected.length;
}

function decodeFormValue(value) {
    return new URLSearchParams(`value=${value}`).get("value");
}

function authenticateClient(request, clientId, clientSecret) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string") return false;
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match) return false;

    let credentials;
    try {
        credentials = Buffer.from(match[1], "base64").toString("utf8");
        if (Buffer.from(credentials, "utf8").toString("base64") !== match[1]) return false;
    } catch {
        return false;
    }
    const separator = credentials.indexOf(":");
    if (separator < 0) return false;
    const suppliedId = decodeFormValue(credentials.slice(0, separator));
    const suppliedSecret = decodeFormValue(credentials.slice(separator + 1));
    if (suppliedId === null || suppliedSecret === null) return false;
    return equalSecret(suppliedId, clientId) && equalSecret(suppliedSecret, clientSecret);
}

function base64url(value) {
    return Buffer.from(value).toString("base64url");
}

function jwtSign(claims, type, keyId, privateKey) {
    const header = { alg: "RS256", kid: keyId, typ: type };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString(
        "base64url",
    );
    return `${signingInput}.${signature}`;
}

function verifyAccessJwt(token, { issuer, resource, clientId, publicKey, keyId, activeTokens }) {
    if (typeof token !== "string" || token.length > 16_384) return undefined;
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
        return undefined;
    }

    try {
        const header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
        const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
        if (header.alg !== "RS256" || header.kid !== keyId || header.typ !== "at+jwt") {
            return undefined;
        }
        const validSignature = verify(
            "RSA-SHA256",
            Buffer.from(`${segments[0]}.${segments[1]}`),
            publicKey,
            Buffer.from(segments[2], "base64url"),
        );
        const now = Math.floor(Date.now() / 1000);
        const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        const activeRecord = activeTokens.get(token);
        if (
            !validSignature ||
            claims.iss !== issuer ||
            !audience.includes(resource) ||
            claims.client_id !== clientId ||
            typeof claims.sub !== "string" ||
            typeof claims.jti !== "string" ||
            typeof claims.scope !== "string" ||
            !Array.isArray(claims.permissions) ||
            claims.permissions.some((permission) => typeof permission !== "string") ||
            !Number.isInteger(claims.exp) ||
            claims.exp <= now ||
            !Number.isInteger(claims.iat) ||
            claims.iat > now + 30 ||
            !activeRecord ||
            activeRecord.clientId !== clientId ||
            claims.jti !== activeRecord.jti ||
            claims.sub !== activeRecord.identity.sub
        ) {
            return undefined;
        }
        return claims;
    } catch {
        return undefined;
    }
}

function pruneExpired(store, time, readExpiry) {
    for (const [key, value] of store) {
        if (readExpiry(value) <= time) store.delete(key);
    }
}

function appendAuthorizationCode(redirectUri, code, state) {
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    return callback.href;
}

function parseAuthorizationRequest(url, { appOrigin, clientId, resource }) {
    const params = url.searchParams;
    const requestedClientId = readUnique(params, "client_id");
    const redirectUri = readUnique(params, "redirect_uri");
    const responseType = readUnique(params, "response_type");
    const scope = readUnique(params, "scope");
    const state = readUnique(params, "state");
    const nonce = readUnique(params, "nonce");
    const challenge = readUnique(params, "code_challenge");
    const challengeMethod = readUnique(params, "code_challenge_method");
    const requestedResource = readUnique(params, "resource");

    if (requestedClientId !== clientId) throw new ProviderError(400, "unauthorized_client");
    if (responseType !== "code") throw new ProviderError(400, "unsupported_response_type");
    if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
        throw new ProviderError(400, "invalid_request");
    }
    if (!/^[A-Za-z0-9._~-]{1,512}$/.test(state) || !/^[A-Za-z0-9._~-]{1,512}$/.test(nonce)) {
        throw new ProviderError(400, "invalid_request");
    }
    const scopes = new Set(scope.split(/\s+/).filter(Boolean));
    if (!scopes.has("openid") || !scopes.has("email")) {
        throw new ProviderError(400, "invalid_scope");
    }
    if (requestedResource !== resource) throw new ProviderError(400, "invalid_target");

    let callback;
    try {
        callback = new URL(redirectUri);
    } catch {
        throw new ProviderError(400, "invalid_request");
    }
    if (
        callback.origin !== appOrigin ||
        callback.pathname !== CALLBACK_PATH ||
        callback.username ||
        callback.password ||
        callback.search ||
        callback.hash
    ) {
        throw new ProviderError(400, "invalid_request");
    }

    return { clientId, redirectUri: callback.href, scope, state, nonce, challenge, resource };
}

function issueAccessToken({ identity, scope, resource, clientId, issuer, privateKey, keyId }) {
    const now = Math.floor(Date.now() / 1000);
    const jti = randomBytes(24).toString("base64url");
    const claims = {
        iss: issuer,
        sub: identity.sub,
        aud: resource,
        client_id: clientId,
        scope,
        permissions: identity.permissions,
        jti,
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_SECONDS,
    };
    const token = jwtSign(claims, "at+jwt", keyId, privateKey);
    return { token, jti, claims };
}

function issueIdToken({ identity, scope, nonce, clientId, issuer, privateKey, keyId }) {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iss: issuer,
        sub: identity.sub,
        aud: clientId,
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_SECONDS,
        nonce,
        auth_time: now,
    };
    if (scope.split(/\s+/).includes("email")) {
        claims.email = identity.email;
        claims.email_verified = true;
    }
    if (scope.split(/\s+/).includes("profile")) claims.name = identity.name;
    return jwtSign(claims, "JWT", keyId, privateKey);
}

/**
 * Start a minimal, in-memory OIDC issuer for browser integration tests.
 * It always binds to IPv4 loopback and accepts redirect URIs only at the
 * configured loopback app origin and the Basishacks callback path.
 */
export async function startOidcTestProvider(options) {
    if (process.env.NODE_ENV === "production") {
        throw new Error("The E2E OIDC provider cannot start in production mode");
    }
    if (!options || typeof options !== "object") throw new TypeError("options are required");
    const clientId = assertString(options.clientId, "clientId", { max: 255 });
    const clientSecret = assertString(options.clientSecret, "clientSecret", { min: 16, max: 512 });
    const resource = assertString(options.resource, "resource", { max: 2048 });
    const appOrigin = assertLoopbackAppOrigin(options.appOrigin);
    const users = normalizeUsers(options.users);

    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicExponent: 0x10001,
    });
    const publicJwk = publicKey.export({ format: "jwk" });
    const keyId = createHash("sha256")
        .update(publicKey.export({ format: "der", type: "spki" }))
        .digest("base64url");

    const pendingAuthorizations = new Map();
    const authorizationCodes = new Map();
    const accessTokens = new Map();
    const refreshTokens = new Map();
    let issuer = "";
    let closed = false;

    function pruneStores() {
        const now = Date.now();
        pruneExpired(pendingAuthorizations, now, (record) => record.expiresAt);
        pruneExpired(authorizationCodes, now, (record) => record.expiresAt);
        pruneExpired(accessTokens, now, (record) => record.expiresAt);
        pruneExpired(refreshTokens, now, (record) => record.expiresAt);
    }

    function putBounded(store, key, value, maxEntries) {
        pruneStores();
        if (store.size >= maxEntries) throw new ProviderError(503, "temporarily_unavailable");
        store.set(key, value);
    }

    function issueTokens(record, { includeIdToken, replacingRefreshToken }) {
        pruneStores();
        const refreshCapacityAfterReplacement =
            refreshTokens.size -
            (replacingRefreshToken && refreshTokens.has(replacingRefreshToken) ? 1 : 0);
        if (
            accessTokens.size >= MAX_ACCESS_TOKENS ||
            refreshCapacityAfterReplacement >= MAX_REFRESH_TOKENS
        ) {
            throw new ProviderError(503, "temporarily_unavailable");
        }

        const access = issueAccessToken({
            identity: record.identity,
            scope: record.scope,
            resource: record.resource,
            clientId,
            issuer,
            privateKey,
            keyId,
        });
        const accessExpiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000;
        const refreshToken = randomBytes(32).toString("base64url");
        const response = {
            access_token: access.token,
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: refreshToken,
            scope: record.scope,
        };
        if (includeIdToken) {
            response.id_token = issueIdToken({
                identity: record.identity,
                scope: record.scope,
                nonce: record.nonce,
                clientId,
                issuer,
                privateKey,
                keyId,
            });
        }

        if (replacingRefreshToken) refreshTokens.delete(replacingRefreshToken);
        accessTokens.set(access.token, {
            identity: record.identity,
            clientId,
            jti: access.jti,
            expiresAt: accessExpiresAt,
        });
        refreshTokens.set(refreshToken, {
            identity: record.identity,
            scope: record.scope,
            resource: record.resource,
            expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
        });
        return response;
    }

    const server = createServer((request, response) => {
        void handleRequest(request, response).catch((error) => {
            if (response.headersSent || response.destroyed) {
                response.destroy();
                return;
            }
            if (error instanceof ProviderError) {
                sendJson(
                    response,
                    error.statusCode,
                    { error: error.oauthError },
                    {
                        basicChallenge: error.oauthError === "invalid_client",
                    },
                );
                return;
            }
            sendJson(response, 500, { error: "server_error" });
        });
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    server.keepAliveTimeout = 1_000;
    server.maxHeadersCount = 64;

    async function handleRequest(request, response) {
        if (closed) throw new ProviderError(503, "temporarily_unavailable");
        if (
            request.socket.remoteAddress !== "127.0.0.1" &&
            request.socket.remoteAddress !== "::ffff:127.0.0.1"
        ) {
            throw new ProviderError(403, "access_denied");
        }

        const host = request.headers.host;
        const expectedHost = new URL(issuer).host;
        if (host !== expectedHost) throw new ProviderError(400, "invalid_request");

        const requestUrl = new URL(request.url ?? "/", issuer);
        if (requestUrl.origin !== issuer) throw new ProviderError(400, "invalid_request");

        if (
            request.method === "GET" &&
            requestUrl.pathname === "/.well-known/openid-configuration"
        ) {
            return sendJson(response, 200, {
                issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`,
                userinfo_endpoint: `${issuer}/userinfo`,
                jwks_uri: `${issuer}/oauth/jwks`,
                revocation_endpoint: `${issuer}/revoke`,
                response_types_supported: ["code"],
                grant_types_supported: ["authorization_code", "refresh_token"],
                subject_types_supported: ["public"],
                id_token_signing_alg_values_supported: ["RS256"],
                scopes_supported: [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "nethack.access",
                ],
                token_endpoint_auth_methods_supported: ["client_secret_basic"],
                revocation_endpoint_auth_methods_supported: ["client_secret_basic"],
                code_challenge_methods_supported: ["S256"],
            });
        }

        if (request.method === "GET" && requestUrl.pathname === "/oauth/jwks") {
            return sendJson(response, 200, {
                keys: [
                    {
                        kty: "RSA",
                        use: "sig",
                        alg: "RS256",
                        kid: keyId,
                        n: publicJwk.n,
                        e: publicJwk.e,
                    },
                ],
            });
        }

        if (request.method === "GET" && requestUrl.pathname === "/authorize") {
            const authorization = parseAuthorizationRequest(requestUrl, {
                appOrigin,
                clientId,
                resource,
            });
            pruneStores();
            if (pendingAuthorizations.size >= MAX_PENDING_AUTHORIZATIONS) {
                throw new ProviderError(503, "temporarily_unavailable");
            }
            const ticket = randomBytes(32).toString("base64url");
            pendingAuthorizations.set(ticket, {
                ...authorization,
                expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
            });
            const choices = users
                .map(
                    (user) =>
                        `<button type="submit" name="sub" value="${escapeHtml(user.sub)}">${escapeHtml(user.name)} — ${escapeHtml(user.email)}</button>`,
                )
                .join("\n");
            return sendHtml(
                response,
                200,
                `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Choose test identity</title></head><body><main><h1>Choose a test identity</h1><form method="post" action="${issuer}/authorize/consent"><input type="hidden" name="ticket" value="${ticket}"><fieldset><legend>Available E2E identities</legend>${choices}</fieldset></form></main></body></html>`,
            );
        }

        if (request.method === "POST" && requestUrl.pathname === "/authorize/consent") {
            const origin = request.headers.origin;
            // Opaque browser origins serialize as "null"; the unguessable, single-use ticket remains the CSRF proof.
            if (origin !== issuer && origin !== "null") {
                throw new ProviderError(403, "access_denied");
            }
            const params = await readForm(request);
            const ticket = readUnique(params, "ticket");
            const subject = readUnique(params, "sub");
            const authorization = pendingAuthorizations.get(ticket);
            pendingAuthorizations.delete(ticket);
            if (!authorization || authorization.expiresAt <= Date.now()) {
                throw new ProviderError(400, "invalid_request");
            }
            const identity = users.find((user) => user.sub === subject);
            if (!identity) throw new ProviderError(400, "invalid_request");

            const code = randomBytes(32).toString("base64url");
            putBounded(
                authorizationCodes,
                code,
                {
                    ...authorization,
                    identity,
                    expiresAt: Date.now() + CODE_TTL_MS,
                },
                MAX_AUTHORIZATION_CODES,
            );
            response.statusCode = 302;
            response.setHeader("Cache-Control", "no-store");
            response.setHeader(
                "Location",
                appendAuthorizationCode(authorization.redirectUri, code, authorization.state),
            );
            response.end();
            return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/token") {
            if (!authenticateClient(request, clientId, clientSecret)) {
                throw new ProviderError(401, "invalid_client");
            }
            const params = await readForm(request);
            const grantType = readUnique(params, "grant_type");
            const suppliedClientId = readUnique(params, "client_id", { required: false });
            if (suppliedClientId !== undefined && suppliedClientId !== clientId) {
                throw new ProviderError(401, "invalid_client");
            }
            const suppliedResource = readUnique(params, "resource", { required: false });
            if (suppliedResource !== undefined && suppliedResource !== resource) {
                throw new ProviderError(400, "invalid_target");
            }

            if (grantType === "authorization_code") {
                const code = readUnique(params, "code");
                const redirectUri = readUnique(params, "redirect_uri");
                const verifier = readUnique(params, "code_verifier");
                const authorization = authorizationCodes.get(code);
                authorizationCodes.delete(code);
                if (
                    !authorization ||
                    authorization.expiresAt <= Date.now() ||
                    authorization.clientId !== clientId ||
                    authorization.redirectUri !== redirectUri ||
                    verifier.length < 43 ||
                    verifier.length > 128 ||
                    !/^[A-Za-z0-9._~-]+$/.test(verifier)
                ) {
                    throw new ProviderError(400, "invalid_grant");
                }
                const computedChallenge = createHash("sha256").update(verifier).digest("base64url");
                if (!equalSecret(computedChallenge, authorization.challenge)) {
                    throw new ProviderError(400, "invalid_grant");
                }
                return sendJson(
                    response,
                    200,
                    issueTokens(authorization, { includeIdToken: true }),
                );
            }

            if (grantType === "refresh_token") {
                const suppliedRefreshToken = readUnique(params, "refresh_token");
                const refresh = refreshTokens.get(suppliedRefreshToken);
                if (!refresh || refresh.expiresAt <= Date.now()) {
                    refreshTokens.delete(suppliedRefreshToken);
                    throw new ProviderError(400, "invalid_grant");
                }
                const record = {
                    identity: refresh.identity,
                    scope: refresh.scope,
                    resource: refresh.resource,
                };
                return sendJson(
                    response,
                    200,
                    issueTokens(record, {
                        includeIdToken: false,
                        replacingRefreshToken: suppliedRefreshToken,
                    }),
                );
            }
            throw new ProviderError(400, "unsupported_grant_type");
        }

        if (request.method === "GET" && requestUrl.pathname === "/userinfo") {
            const authorization = request.headers.authorization;
            const match =
                typeof authorization === "string" ? /^Bearer (\S+)$/i.exec(authorization) : null;
            const token = match?.[1];
            const claims = verifyAccessJwt(token, {
                issuer,
                resource,
                clientId,
                publicKey,
                keyId,
                activeTokens: accessTokens,
            });
            if (!claims) throw new ProviderError(401, "invalid_token");
            const record = accessTokens.get(token);
            if (!record || claims.sub !== record.identity.sub) {
                throw new ProviderError(401, "invalid_token");
            }
            const userInfo = { sub: record.identity.sub };
            if (claims.scope.split(/\s+/).includes("email")) {
                userInfo.email = record.identity.email;
                userInfo.email_verified = true;
            }
            if (claims.scope.split(/\s+/).includes("profile")) userInfo.name = record.identity.name;
            return sendJson(response, 200, userInfo);
        }

        if (request.method === "POST" && requestUrl.pathname === "/revoke") {
            if (!authenticateClient(request, clientId, clientSecret)) {
                throw new ProviderError(401, "invalid_client");
            }
            const params = await readForm(request);
            const token = readUnique(params, "token");
            refreshTokens.delete(token);
            accessTokens.delete(token);
            return sendJson(response, 200, {});
        }

        throw new ProviderError(404, "not_found");
    }

    try {
        await new Promise((resolveListen, rejectListen) => {
            const onListening = () => {
                server.off("error", onError);
                resolveListen();
            };
            const onError = (error) => {
                server.off("listening", onListening);
                rejectListen(error);
            };
            server.once("listening", onListening);
            server.once("error", onError);
            server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
        });
    } catch (error) {
        server.closeAllConnections();
        throw error;
    }
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        server.closeAllConnections();
        await new Promise((resolveClose) => server.close(() => resolveClose()));
        throw new Error("OIDC test provider failed to bind to IPv4 loopback");
    }
    issuer = `http://127.0.0.1:${address.port}`;

    let closePromise;
    return Object.freeze({
        issuer,
        close() {
            if (closePromise) return closePromise;
            closed = true;
            pendingAuthorizations.clear();
            authorizationCodes.clear();
            accessTokens.clear();
            refreshTokens.clear();
            server.closeAllConnections();
            closePromise = new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
            return closePromise;
        },
    });
}
