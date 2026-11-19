---
title: basis-auth Integration
description: OpenID Connect client and resource-server integration with basis-auth.
---

# basis-auth Integration

nethack is an OpenID Connect confidential client and a protected resource of basis-auth. It is no longer an OAuth provider.

## Registration

Register one confidential client in basis-auth without changing basis-auth source code. Its redirect URI set must contain every deployed callback, for example:

```text
${CURRENT_URL_ORIGIN}/api/auth/basis/callback
```

Set `CURRENT_URL_ORIGIN` in the deployment `.env` to the public nethack origin. The application derives the callback and canonical URLs from that variable.

Register `devconnect://nethack.bisz.dev` as a resource and use the same value for `BASIS_AUTH_RESOURCE`. The login request is `openid profile email offline_access`; basis-auth supplies feature authorization in the access-token `permissions` array, so application permissions are not requested as OAuth scopes.

basis-auth requires the resource to have a verified backchannel logout URL before authorization-code sign-in works; without one the authorize request fails with `14408 invalid_resource`. Register this receiver in the resource's Backchannel tab:

```text
${CURRENT_URL_ORIGIN}/api/auth/basis/backchannel
```

The URL must be HTTPS, or `http://localhost` for local testing, and reachable from basis-auth. The receiver must also reach the basis-auth private listener.

## Client configuration

| Variable | Purpose |
| --- | --- |
| `BASIS_AUTH_ISSUER` | Exact issuer used for discovery and validation |
| `BASIS_AUTH_CLIENT_ID` | nethack confidential client ID |
| `BASIS_AUTH_CLIENT_SECRET` | Server-only client secret |
| `BASIS_AUTH_RESOURCE` | Expected resource audience |
| `BASIS_AUTH_RESOURCE_SECRET` | Resource secret used for the webhook proof and private listener auth |
| `BASIS_AUTH_INTERNAL_URL` | basis-auth private listener origin (default `http://127.0.0.1:3001`) |
| `CURRENT_URL_ORIGIN` | Origin from which the callback URL is derived |

Production startup fails when `BASIS_AUTH_RESOURCE_SECRET` or `BASIS_AUTH_INTERNAL_URL` is missing, because the resource cannot complete webhook verification or answer revocation events.

In production, `CURRENT_URL_ORIGIN` must be a public HTTPS origin without a path, query, fragment, or credentials. Loopback HTTP origins (`http://localhost`, `http://127.0.0.1`, or `http://[::1]`) are accepted for local production only while the server binds to loopback; the launcher sets that bind and the matching port when no explicit values are configured, and auth cookies omit the Secure flag so browsers retain them. The exact callback must be registered for the confidential basis-auth client; basis-auth does not accept arbitrary localhost redirects for confidential clients. The client uses discovery, authorization code, S256 PKCE, state, nonce, `client_secret_basic`, ID-token validation, and UserInfo. Failed discovery is retryable instead of being cached for the process lifetime. Access and refresh tokens are compressed and sealed with AES-256-GCM into an HTTP-only cookie; they are not stored in PostgreSQL or exposed to browser JavaScript. `GET /api/auth/session` returns only the local user ID, expiry, and permission list for display decisions.

## Backchannel logout and revocation

`POST /api/auth/basis/backchannel` handles all three events basis-auth delivers to one URL:

| Event | Handling |
| --- | --- |
| `action=test` | Answers `202`, then posts `HMAC-SHA256(challenge)` to `/internal/backchannel/validate` with `Authorization: Bearer <resource secret>` and `X-Basis-Resource: <URL-encoded audience>` |
| `logout_token` | Verifies `typ=logout+jwt`, issuer, resource audience, expiry, `sub`, and the backchannel event, then sets `users.tokens_valid_after` for that subject |
| `action=revoke_access_token` | Verifies `typ=at-revocation+jwt` and requires the signed `access_token_jti` and `valid_after` to match the form fields, then denylists the `jti` |

`revoked_access_tokens` stores the denylist with the earliest `valid_after` per delivery and the signed `access_token_expires_at` for cleanup. Rows are removed after expiry plus the verifier clock tolerance. `users.tokens_valid_after` is a per-subject barrier: a token whose `iat` is at or before it is rejected even if the cookie and token are otherwise intact.

## Protected API validation

`server/utils/oauth2-jwt.ts` loads the provider JWKS and validates access tokens with exact issuer and audience checks, RS256, access-token type, expiry, basis-schema claims, and stable subject mapping. Delegated scopes use the shared hierarchy matcher: `.all` grants descendant leaves, while `.*` is unsupported. Hackathon roles remain application-local. The verifier deliberately does not accept legacy nethack HS256 tokens.

After signature validation, `server/utils/basis-auth-state.ts` rejects deny-listed `jti` values, tokens older than the local logout barrier, and disabled basis-auth users. The user-state lookup goes to `GET /internal/users/:subject` on the private listener, is cached for one minute per subject, and fails closed with a 15-second backoff while the listener is unreachable. A loopback `CURRENT_URL_ORIGIN` is treated as a development instance even under `NODE_ENV=production`, so it keeps working without a route to a remote private listener; the denylist and logout barrier always apply.

Every rejected token produces the same public response: HTTP `401`, `WWW-Authenticate: Bearer error="invalid_token"`, and the `Invalid access token` description. Missing scopes and permissions remain `403`. Optional-authentication reads treat a stale session cookie as anonymous and clear it, while an explicit invalid bearer token still returns `401`.

## Legacy data

The retired provider routes and developer application-management pages have been removed. The `oauth2_applications` table is retained as historical data; migrations do not drop it and user deletion detaches rather than removes legacy client records.
