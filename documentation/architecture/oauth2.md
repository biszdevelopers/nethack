---
title: basis-auth Integration
description: OpenID Connect client and resource-server integration with basis-auth.
---

# basis-auth Integration

basishacks is an OpenID Connect confidential client and a protected resource of basis-auth. It is no longer an OAuth provider.

## Registration

Register one confidential client in basis-auth without changing basis-auth source code. Its redirect URI set must contain every deployed callback, for example:

```text
http://localhost:24598/api/auth/basis/callback
https://nethack.biszweb.club/api/auth/basis/callback
```

Register `devconnect://nethack.bisz.dev` as a resource and use the same value for `BASIS_AUTH_RESOURCE`. The login request is `openid profile email offline_access`; basis-auth supplies feature authorization in the access-token `permissions` array, so application permissions are not requested as OAuth scopes.

## Client configuration

| Variable | Purpose |
| --- | --- |
| `BASIS_AUTH_ISSUER` | Exact issuer used for discovery and validation |
| `BASIS_AUTH_CLIENT_ID` | basishacks confidential client ID |
| `BASIS_AUTH_CLIENT_SECRET` | Server-only client secret |
| `BASIS_AUTH_RESOURCE` | Expected resource audience |
| `BASIS_AUTH_INTERNAL_URL` | Server-only Basis Auth internal listener origin |
| `BASIS_AUTH_RESOURCE_SECRET` | Current server-only secret for the resource audience |
| `BASIS_AUTH_ACCESS_TOKEN_LIFETIME_SECONDS` | Longest provider token lifetime for legacy revocation retention (default 3600 seconds) |
| `CURRENT_URL_ORIGIN` | Origin from which the callback URL is derived |

In production, `CURRENT_URL_ORIGIN` must be a public HTTPS origin without a path, query, fragment, or credentials. Loopback HTTP origins (`http://localhost`, `http://127.0.0.1`, or `http://[::1]`) are accepted for local production only while the server binds to loopback; the launcher sets that bind and the matching port when no explicit values are configured, and auth cookies omit the Secure flag so browsers retain them. The exact callback must be registered for the confidential basis-auth client; basis-auth does not accept arbitrary localhost redirects for confidential clients. The client uses discovery, authorization code, S256 PKCE, state, nonce, `client_secret_basic`, ID-token validation, and UserInfo. Failed discovery is retryable instead of being cached for the process lifetime. Access and refresh tokens are compressed and sealed with AES-256-GCM into an HTTP-only cookie; they are not stored in PostgreSQL or exposed to browser JavaScript. `GET /api/auth/session` returns only the local user ID, expiry, and permission list for display decisions.

## Backchannel registration

Deploy the receiver and apply PostgreSQL migration `0010_basis_auth_backchannel` through startup or `bun run db:migrate`. Set the internal listener origin and current resource secret in the basishacks server environment. The resource secret comes from the resource's **Secret** tab in Basis Auth and authenticates the challenge proof. Rotate it in both places when it changes.

In **Resource Servers → Backchannel**, save the full basishacks URL for `BASIS_AUTH_RESOURCE`. Use HTTPS or HTTP with the hostname exactly `localhost`. For example, `http://localhost:24598/api/auth/backchannel-logout` works when both services run on the same host. Basis Auth must be able to reach the receiver, and the receiver must be able to reach the internal listener. The latter defaults to port 3001.

Basis Auth saves the URL after a `202` response and successful HMAC proof to its internal listener. Confirm the saved address in the resource's Backchannel tab. For bootstrap before sign-in, add `"backchannelLogoutUri": "http://localhost:24598/api/auth/backchannel-logout"` to the matching resource entry in Basis Auth's `OIDC_RESOURCES_JSON`, preserving the entry's other settings. Start the receiver before Basis Auth performs the bootstrap challenge. Authorization-code sign-in and refresh require a valid saved webhook for the requested resource.

For revocations with a signed access-token expiration, retention covers that expiration plus verifier clock tolerance, with a minimum of one hour from the signed event's issuance. Older sessions with unknown access-token expiration use the issuer's one-hour default. Set `BASIS_AUTH_ACCESS_TOKEN_LIFETIME_SECONDS` to the longest lifetime issued for this audience if it exceeds one hour. The matching issuer setting is `ACCESS_TOKEN_LIFETIME_MS`, expressed in milliseconds.

## Protected API validation

`server/utils/basis-auth-jwt.ts` shares the issuer's `/oauth/jwks` cache across access, revocation, and logout token verification. Access-token validation requires the configured issuer and audience, RS256, `typ=at+jwt`, expiry, and basis-schema claims. Protected requests check PostgreSQL for an effective JTI revocation or subject logout before resolving the linked local user. Invalid credentials return HTTP 401 with `Invalid access token`. Requests with bearer credentials also get `WWW-Authenticate: Bearer error="invalid_token"`. Valid tokens still receive the usual permission and scope errors. Delegated scopes use the shared hierarchy matcher. `.all` grants descendant leaves. Hackathon roles remain application-local.

## Legacy data

The retired provider routes and developer application-management pages have been removed. The `oauth2_applications` table is retained as historical data; migrations do not drop it and user deletion detaches rather than removes legacy client records.
