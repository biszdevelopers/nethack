---
title: Environment Setup
description: Configure environment variables, install tooling, and prepare your IDE for nethack development.
---

# Environment Setup

This guide covers everything you need to configure before developing nethack, from environment variables to IDE setup.

## Prerequisites

Ensure the following are installed before proceeding:

| Tool        | Version    | Install                                                   |
| ----------- | ---------- | --------------------------------------------------------- |
| **Node.js** | >= v24     | [nodejs.org](https://nodejs.org) or use a version manager |
| **Bun**     | 1.3.14     | [bun.sh](https://bun.sh)                                  |
| **Git**     | Any recent | [git-scm.com](https://git-scm.com)                        |

### Node.js v24+ Installation

Using a version manager is recommended to easily switch between Node.js versions:

```bash
# Using fnm (recommended)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24
fnm use 24

# Using nvm
nvm install 24
nvm use 24
```

Verify the installation:

```bash
node --version
# Should output v24.x.x or higher
```

:::: warning Node.js v24 or higher is required. Older versions may cause runtime errors or missing APIs. ::::

### Bun Installation

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"

# Verify
bun --version
```

## Clone and Install

```bash
git clone <repository-url> nethack
git clone https://github.com/biszdevelopers/basis-schema.git basis-schema
cd nethack
bun i
```

Keep [`@basis/schema`](https://github.com/biszdevelopers/basis-schema) as a sibling checkout. Local builds and tests resolve its source through `../basis-schema`; CI, lint, and release workflows clone that source before installing dependencies. Use Bun 1.3.14 to keep the lockfile and dependency overrides compatible with the supported runtime.

::: tip Dependency overrides

`package.json` uses Bun 1.3.14 compatible overrides to keep transitive dependencies on security-fixed releases. Vite is constrained to `^8.3.5`, the range required by the current Nuxt release. The `deepmerge` override points to an in-repository prototype-safe compatibility package; the Rollup resolver patch no longer imports upstream `deepmerge`.

Keep the overrides and `bun.lock` in sync when upgrading dependencies. :::

## Database Initialization

Local development, CI, and production use PostgreSQL. Set `DATABASE_URL` to a reachable PostgreSQL instance before starting Nuxt. The Nitro startup plugin creates a bounded pool, applies migrations under a PostgreSQL advisory lock, and seeds the default hackathon row. Set `YAML_SOURCE_HACKATHON=local` for the checkout's `HACKATHON.yml`, or set an assets server origin or full manifest URL. See [live configuration cutover](/deployment/postgresql-migration#move-the-live-hackathon-configuration-to-yaml).

### Applying Migrations

Migrations are generated with Drizzle Kit:

```bash
# Generate a migration after schema changes
bun run db:generate
```

The server applies migrations automatically before accepting requests. You can apply them explicitly before a release:

```bash
# Apply migrations
bun run db:migrate
```

For an existing SQLite deployment, follow the [PostgreSQL migration and cutover procedure](/deployment/postgresql-migration). The application no longer uses SQLite at runtime.

## Environment Variables

The project uses environment variables for configuration. Copy the example file to get started:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Description | Example |
| --- | --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URL | `postgresql://nethack:secret@127.0.0.1:5432/nethack` |
| `BASIS_AUTH_COOKIE_SECRET` | Session and token-record encryption key. **Must be at least 32 bytes.** | Output of `openssl rand -base64 32` |
| `BASIS_AUTH_ISSUER` | Exact basis-auth issuer URL | `http://localhost:3000` |
| `BASIS_AUTH_CLIENT_ID` | Registered confidential nethack client ID | Provider-generated value |
| `BASIS_AUTH_CLIENT_SECRET` | Server-only nethack client secret | Provider-generated value |
| `BASIS_AUTH_RESOURCE` | Resource audience registered for nethack | `devconnect://nethack.bisz.dev` |
| `BASIS_AUTH_RESOURCE_SECRET` | Resource secret issued by basis-auth | Provider-generated value |
| `BASIS_AUTH_INTERNAL_URL` | basis-auth private listener origin | `http://127.0.0.1:3001` |

::: tip Login is delegated to basis-auth. Register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` for each environment. Register `${CURRENT_URL_ORIGIN}/api/auth/basis/backchannel` as the resource's backchannel logout URL; sign-in fails with `14408 invalid_resource` while that URL is unverified. :::

#### Generating a Session Password

```bash
openssl rand -base64 32
```

Copy the output and paste it as the value for `BASIS_AUTH_COOKIE_SECRET`.

### Optional Variables

#### Microsoft Entra ID

| Variable | Description | Default |
| --- | --- | --- |
| `MICROSOFT_TENANT_ID` | Microsoft Entra ID tenant used by optional Graph features. | — |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra ID client used by optional Graph features. | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft Entra ID client secret for Graph features. | — |
| `MICROSOFT_WEBHOOK_STATE` | Persistent Graph webhook validation secret (minimum 32 bytes). | — |
| `MICROSOFT_WEBHOOK_ID` | Existing Graph subscription ID; set it after the first subscription is created. | — |

#### Public origin

| Variable | Description | Default |
| --- | --- | --- |
| `CURRENT_URL_ORIGIN` | Required public origin used for canonical page URLs, the basis-auth callback, and same-origin request checks. Loopback HTTP origins are accepted only while bound to loopback. | Set it in `.env`; the example uses a local origin |

#### Live manifest and local caches

| Variable | Description | Default |
| --- | --- | --- |
| `YAML_SOURCE_HACKATHON` | Blank or `local` reads the checkout's `HACKATHON.yml`; an assets server origin or full HTTPS manifest URL loads it remotely; `database` restores PostgreSQL-backed live settings. Remote manifests are revalidated at most every five minutes. A local manifest is writable from the mod portal; a remote manifest is read-only. | `local` |
| `HACKATHON_CONFIG_PATH` | Local manifest the portal reads and, in `local` mode, rewrites | `HACKATHON.yml` |
| `HACKATHON_CACHE_PATH` | File that stores the last successfully fetched remote manifest, used when the assets server is unavailable at startup | `assets/hackathon-config.yml` |
| `BASIS_AUTH_PICTURE_CACHE_DIR` | Directory that stores basis-auth avatar bytes so profile pictures survive a provider outage | `assets/basis-auth-pictures` |

#### Integrations & Server

| Variable | Description | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key for AI chat features (debug routes only). Uses the OpenAI SDK under the hood. | — |
| `PORT` | Server port override | `3000` |
| `HOST` | Server host override | `0.0.0.0` |
| `DATABASE_POOL_MAX` | Maximum PostgreSQL connections; integer from 2 through 64 | `10` |
| `DATABASE_METRICS` | Set to `1` to emit bounded PostgreSQL query-runtime and pool-acquisition wait summaries every minute | unset |
| `SQLITE_IMPORT_PATH` | Source SQLite backup path for the one-time migration command only | unset |
| `MICROSOFT_DUMMY_USER_NAME` | ROPC test user email (rarely used, testing only) | — |
| `MICROSOFT_DUMMY_USER_PASSWORD` | ROPC test user password (rarely used, testing only) | — |

#### Rate Limiting

| Variable | Description | Default |
| --- | --- | --- |
| `RATE_LIMIT_GENERAL_MAX` | General API rate limit, requests per minute | `1200` |
| `RATE_LIMIT_AUTH_MAX` | Authentication endpoint rate limit, attempts per minute | `200` |
| `RATE_LIMIT_VOTE_MAX` | Voting/scoring endpoint rate limit, submissions per minute | `300` |
| `RATE_LIMIT_UPLOAD_MAX` | File upload endpoint rate limit, uploads per minute | `100` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `60000` |
| `TRUSTED_PROXY_HOPS` | Exact number of trusted reverse proxies (0–10); forwarded addresses are used only when the chain contains enough valid IPs | `0` |

#### Production

| Variable | Description | Default |
| --- | --- | --- |
| `DISABLE_DEBUG_ROUTES` | Set to any truthy value to disable debug routes outside production; production disables them automatically | unset |

#### Tooling only

These are read by development scripts, never by the running server.

| Variable | Description | Default |
| --- | --- | --- |
| `BASISHACKS_E2E_DATABASE_URL` | Separate loopback PostgreSQL URL for the disposable database named `basishacks_e2e`; never read by the app server | Set it in `.env` for browser tests |
| `PLAYWRIGHT_BASE_URL` | Required loopback HTTP origin for the isolated end-to-end Playwright app | Set it in `.env`; the sample shows the test origin |
| `ASSET_STORAGE_DIR` | Absolute asset storage root honored only while `NODE_ENV=test`, so Vitest can redirect uploads into a temporary directory; ignored in every other runtime | unset |
| `VPS_RELEASE_OUTPUT_DIR` | Directory `bun run release:package` writes the deployable bundle into | `release-package` |
| `VPS_RELEASE_INCLUDE_NODE_MODULES` | Set to `1` to copy production `node_modules` into the release bundle | unset |
| `BENCHMARK_HEADERS_JSON` | JSON object of extra request headers for `bun run benchmark:vps` | unset |

### Complete .env Example

```bash
# REQUIRED - PostgreSQL connection
DATABASE_URL=postgresql://nethack:replace_me@127.0.0.1:5432/nethack

# REQUIRED - Session and token encryption key, must be at least 32 bytes
BASIS_AUTH_COOKIE_SECRET=your_random_string_at_least_32_bytes_long

# REQUIRED - basis-auth confidential client configuration
BASIS_AUTH_ISSUER=http://localhost:3000
BASIS_AUTH_CLIENT_ID=your_basis_auth_client_id
BASIS_AUTH_CLIENT_SECRET=your_basis_auth_client_secret
BASIS_AUTH_RESOURCE=devconnect://nethack.bisz.dev
BASIS_AUTH_RESOURCE_SECRET=your_basis_auth_resource_secret
BASIS_AUTH_INTERNAL_URL=http://127.0.0.1:3001

# OPTIONAL - Live event configuration source: local | manifest URL | database
YAML_SOURCE_HACKATHON=local

# OPTIONAL - Local manifest the mod portal reads and rewrites
# HACKATHON_CONFIG_PATH=HACKATHON.yml

# OPTIONAL - Remote manifest backup and basis-auth avatar cache locations
# HACKATHON_CACHE_PATH=assets/hackathon-config.yml
# BASIS_AUTH_PICTURE_CACHE_DIR=assets/basis-auth-pictures

# OPTIONAL - Microsoft Entra ID tenant ID (directory ID)
MICROSOFT_TENANT_ID=your_microsoft_tenant_id_here

# OPTIONAL - Microsoft Entra ID application (client) ID
MICROSOFT_CLIENT_ID=your_microsoft_client_id_here

# OPTIONAL - Microsoft Entra ID client secret for MS Graph API integration
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret_here

# REQUIRED in production - public HTTPS origin; loopback HTTP is allowed for local production
# The callback is /api/auth/basis/callback
CURRENT_URL_ORIGIN=http://localhost:3000


# OPTIONAL - DeepSeek API key for AI chat features (debug routes only)
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# OPTIONAL - Server port/host override
# PORT=3000
# HOST=0.0.0.0

# OPTIONAL - ROPC test credentials (testing only)
# MICROSOFT_DUMMY_USER_NAME=test_user@example.com
# MICROSOFT_DUMMY_USER_PASSWORD=test_password


# OPTIONAL - Rate limiting overrides (defaults shown)
# RATE_LIMIT_GENERAL_MAX=1200
# RATE_LIMIT_AUTH_MAX=200
# RATE_LIMIT_VOTE_MAX=300
# RATE_LIMIT_UPLOAD_MAX=100
# RATE_LIMIT_WINDOW_MS=60000


# OPTIONAL - Trust exactly one reverse proxy for rate-limit client IP resolution
# TRUSTED_PROXY_HOPS=1

# OPTIONAL - Disable debug routes outside production (they are disabled automatically in production)
# DISABLE_DEBUG_ROUTES=true

# OPTIONAL - Log bounded PostgreSQL query and pool wait timing summaries
# DATABASE_METRICS=1
```

## HTTPS Dev Server Setup

Use HTTPS for local development because secure session cookies require a trusted context:

```bash
bun dev --https
```

The `predev` step reuses an existing `documentation/.vitepress/dist/index.html` instead of rebuilding the docs site on every start; delete that directory (or run the docs build manually) to regenerate it. Production `prebuild` always rebuilds the docs.

The server starts on **port 24598** (configured in `nuxt.config.ts` → `devServer.port`). Open:

```
https://localhost:24598
```

:::: warning The `--https` flag generates a self-signed certificate. Your browser will show a security warning — accept it to proceed. This is expected in local development. ::::

### Custom Port

To use a different port, pass the `--port` flag:

```bash
bun dev --https --port 3000
```

Or modify `nuxt.config.ts`:

```ts
devServer: {
  port: 3000,
}
```

## Database

The project uses PostgreSQL through Drizzle ORM and the `postgres` driver. Bun and Node.js use the same driver and schema. The `init-database.ts` Nitro plugin creates the bounded pool, applies migrations, and seeds the initial records before serving requests. The `02.database.ts` middleware attaches its Drizzle instance to `event.context.drizzle` for each request.

## IDE Setup

### VS Code (Recommended)

Install the following extensions for the best development experience:

| Extension | Purpose |
| --- | --- |
| [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) | Vue 3 IntelliSense, type checking, and template support (formerly Volar) |
| [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) | Real-time linting |
| [Oxc](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode) | Oxfmt code formatting |
| [TypeScript](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-typescript-next) | TypeScript language service |

### Recommended VS Code Settings

Add to `.vscode/settings.json`:

```json
{
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "typescript.tsdk": "node_modules/typescript/lib",
    "vue.inlayHints.inlineHandlerLeading": true
}
```

### EditorConfig

The project includes an `.editorconfig` file that enforces consistent formatting:

- Indent style: spaces
- Indent size: 2
- End of line: lf
- Charset: utf-8
- Trim trailing whitespace: yes
- Insert final newline: yes

## Oxfmt Configuration

The project uses Oxfmt with the settings defined in `.oxfmtrc.json`:

- **Semicolons enabled** — Statements end with semicolons
- **Double quotes** — Strings use double quotes instead of single quotes
- **Tab width 4** — Indentation uses 4 spaces
- **Trailing commas** — Trailing commas are added where valid
- **Print width 100** — Lines wrap at the project’s configured width

Run `bun run format` to format the repository and `bun run format:check` to verify formatting.

Example:

```ts
// Correct (project style)
const name = "nethack";

// Wrong
const name = "nethack";
```

## Production Configuration

In production on the VPS, environment variables are configured through the server environment (for example, systemd service file, `.env` file on the server, or a process manager). Set them before starting the server:

```bash
# Example: setting environment variables before starting the server
DATABASE_URL=postgresql://nethack:secret@127.0.0.1:5432/nethack bun run start
```

Configure credentials in a protected server environment file. For systemd, set `DATABASE_URL` and `DATABASE_POOL_MAX=10` in the service's `EnvironmentFile`; upload storage is always project-root `/assets`, not an environment variable. Make that directory writable by the service account. In-place pull/build/start updates preserve it because git ignores it; preserve or restore it before serving from a re-clone, and back it up separately. See [PostgreSQL and VPS deployment](/deployment/postgresql-migration) for the unit files, import steps, and service hardening.

:::: warning Never commit `.env` files to version control. The `.gitignore` file excludes `.env` by default. ::::

## Verifying Your Setup

After completing all configuration, verify everything works:

```bash
# 1. Install dependencies
bun i

# 2. Initialize the database
bun run db:migrate

# 3. Start the dev server
bun dev --https

# 4. Open https://localhost:24598 in your browser
```

If the page loads without errors, your environment is correctly configured.

## Troubleshooting

### Nitro Legacy Octal Escape on Windows

The custom Nitro error-handler path is normalized in `nuxt.config.ts` before Nitro writes it into a virtual module. If an older checkout reports `Legacy octal escape is not permitted in strict mode` from `virtual:#nitro-internal-virtual/error-handler`, update to the current configuration and restart the dev server. The error is caused by an unescaped Windows backslash followed by digits in the absolute project path, not by `server/error.ts` itself.

### Port Already in Use

If port 24598 is already in use:

```bash
# Find the process using the port (Windows)
netstat -ano | findstr :24598

# Kill the process
taskkill /PID <PID> /F

# Find the process using the port (macOS / Linux)
lsof -i :24598
kill -9 <PID>
```

### Database Errors

If you see database-related errors, confirm `DATABASE_URL` is valid and reachable, then check the startup logs for migration failures. Do not delete or recreate a populated production database as a troubleshooting step. For a local development database, create a separate empty PostgreSQL database and apply `bun run db:migrate`.

### HTTPS Certificate Warnings

The self-signed certificate generated by Nuxt's `--https` flag will trigger browser warnings. This is expected in development. Accept the warning to proceed.

### Session Password Too Short

If you see errors about the session password:

```
Error: Session password must be at least 32 bytes
```

Generate a new password:

```bash
openssl rand -base64 32
```

And update `BASIS_AUTH_COOKIE_SECRET` in your `.env` file.

### Microsoft Graph API Unavailable

If the server logs `[MS Graph] MS Token Endpoint returned 401` or similar, the `MICROSOFT_CLIENT_SECRET` is either missing or invalid. Microsoft configuration affects Graph features only and does not control login.

### basis-auth Configuration Missing

The server validates `BASIS_AUTH_ISSUER`, `BASIS_AUTH_CLIENT_ID`, `BASIS_AUTH_CLIENT_SECRET`, `BASIS_AUTH_RESOURCE`, `BASIS_AUTH_RESOURCE_SECRET`, and `BASIS_AUTH_INTERNAL_URL` at startup:

- **Production:** any missing value, or an internal URL that is not HTTP(S), is fatal.
- **Development/test:** missing values produce a warning; login and revocation state remain unavailable until configured.

The client ID and secret come from basis-auth registration. The callback registered there must exactly match `${CURRENT_URL_ORIGIN}/api/auth/basis/callback`. The resource secret comes from the resource Secret tab and is also used to sign the backchannel webhook proof.

### Login Fails With "Unable to Login" or Error `14408`

basis-auth refuses authorization-code sign-in while the resource has no verified backchannel logout URL. The authorize endpoint returns an `invalid_resource` error and the browser shows the generic login error page. Confirm the code by reading the `basis_bridge_error` cookie payload from the authorization response, for example:

```bash
curl -sD - -o /dev/null "https://auth.example.org/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=openid&resource=...&state=s&nonce=n&code_challenge=...&code_challenge_method=S256"
```

If the payload contains `"code":14408`, register and verify `${CURRENT_URL_ORIGIN}/api/auth/basis/backchannel` in the resource's Backchannel tab. The URL must be reachable from the basis-auth server, so a `localhost` development server cannot satisfy it for a remote issuer; register the deployed origin instead, then sign in locally. `14407` / `14501` mean the resource audience is not registered or not attached to the client, and `14100` means the redirect URI is not registered exactly.
