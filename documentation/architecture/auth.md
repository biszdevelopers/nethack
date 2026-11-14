---
title: Authentication and Authorization
description: basis-auth login, local sessions, identity linking, RBAC, and resource-token validation.
---

# Authentication and Authorization

basishacks delegates user authentication to the separately deployed **basis-auth** OpenID Connect provider. It keeps local user IDs, team membership, votes, and submissions in PostgreSQL. Access and refresh tokens are kept in an encrypted HTTP-only cookie.

## Browser login

`GET /api/login` performs issuer discovery and starts an authorization-code flow with:

- S256 PKCE
- unpredictable `state` and `nonce`
- OAuth scopes `openid profile email offline_access nethack.access`; feature access comes from JWT permissions
- resource `devconnect://nethack.bisz.dev`
- confidential-client authentication with `client_secret_basic`

The callback is derived rather than configured independently:

```text
${CURRENT_URL_ORIGIN}/api/auth/basis/callback
```

The PKCE verifier, state, nonce, start time, and optional safe relative redirect are kept for at most ten minutes in a dedicated encrypted, HTTP-only, SameSite=Lax transaction cookie. The callback consumes that transaction before exchanging the single-use code, validates the ID token, loads UserInfo, and links the local user.

The callback seals the access and refresh tokens with AES-256-GCM and writes them to the `basis-auth-tokens` cookie. The cookie is HTTP-only, SameSite=Lax, secure in production, and limited to 3,800 characters after compression. Its plaintext is never exposed to browser JavaScript. A separate short-lived `basis-auth-flow` cookie stores the PKCE transaction and is deleted when the callback consumes it.

`GET /api/auth/session` validates the cookie-held access token and returns only the local user ID, expiry, and effective permissions. It never returns access or refresh tokens. When the access token nears expiry, the server rotates tokens and reseals the cookie. `POST /api/auth/logout` attempts refresh-token revocation and clears the browser credential even if revocation fails. API routes independently verify tokens from either the HTTP-only cookie or a bearer header.

After an external redirect, route middleware first reconciles `/api/auth/session` with the server instead of trusting stale in-memory state. Login, callback, logout, and session responses are marked `Cache-Control: no-store`.

## Identity linking

The `users` table contains nullable `auth_issuer` and `auth_subject` columns with a unique composite index.

1. A returning identity is resolved by exact issuer and subject.
2. On the first basis-auth login only, the email returned by the configured basis-auth UserInfo endpoint may link to an existing unlinked local user using normalized lowercase comparison. If there is no match, the callback creates a local user.
3. Linking preserves the local integer user ID and all records that reference it.
4. A returning user can update their local email from UserInfo when the address is available. The callback rejects email collisions and attempts to link a second identity to an already linked account.
5. The callback requires an email from subject-validated UserInfo. Account linking depends on the configured basis-auth provider controlling which address it returns for each subject.

The callback stores the basis-auth picture URL from the validated ID token or subject-validated UserInfo. The avatar endpoint loads it from the configured issuer and falls back to an identicon if the provider image is unavailable. Existing local avatars remain usable until a login supplies a provider URL.

## Roles and sessions

The encrypted `basis-auth-tokens` cookie carries the basis-auth access token and refresh token; the browser cannot read it. Protected routes verify the access token from that cookie or an explicit bearer header before applying local authorization:

- `requireUser(event)` loads the local user.
- `requireJudge(event)` permits judges and admins.
- `requireAdmin(event)` permits admins only.

The frontend middleware is a convenience redirect and is never the only authorization check.

## Resource-server tokens

Protected APIs trust basis-auth access tokens only. Validation requires the basis-auth JWKS signature, RS256, the exact configured issuer, the configured audience, `typ=at+jwt`, a valid expiry, and basis-schema access-token claims. The subject maps to a local user through the same issuer-and-subject link. Route access is evaluated from the JWT `permissions` array with the shared nethack permission hierarchy.

For accounts carrying the former `participant`, `judge`, or `admin` permission, basishacks expands that legacy value into the corresponding granular permission bundle before server checks and frontend display gating. This compatibility bridge does not discard granular permissions already present in the token.

The client keeps access tokens only in memory, adds the bearer header to protected requests, unwraps `APIResponse.data`, converts failed envelopes with `APIError.from`, and performs one single-flight refresh-and-retry on an expired-token response.

## Retired provider surface

basishacks no longer exposes its native authorization, token, UserInfo, authorization-session, or application-management routes and pages. The legacy `oauth2_applications` table and existing rows remain untouched for audit and rollback. Graph integration is separate and cannot authenticate a basishacks session.
