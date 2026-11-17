---
title: Legacy Scope Helpers
description: Retained identity-scope helpers for legacy records and rollback tooling
---

# Legacy Scope Helpers

The native nethack provider is retired. New client registration, consent, and scope configuration belong in basis-auth.

`shared/oauth2-scopes.ts` remains only for legacy records and rollback tooling. It defines the standard identity scopes:

| Scope     | Description                                      |
| --------- | ------------------------------------------------ |
| `openid`  | Access basic OpenID Connect identity information |
| `profile` | Access user profile information                  |
| `email`   | Access the user's email address                  |

The module also retains small helpers for parsing, testing, adding, and removing space-separated scope strings. Active nethack resource endpoints validate basis-auth access tokens in `server/utils/oauth2-jwt.ts` using the exact configured issuer, audience, algorithm, token type, expiry, and required route scopes.
