# nethack

The official website for the **BIBS-C Network Hackathon**. Full-stack Nuxt 4 application with basis-auth login, team management, project submission, peer voting, judge scoring, awards, results, and notifications. The home page and header state the event phase plainly (upcoming, live, submissions closed, voting open, voting closed, paused, or ended), including the end date and the next useful action. Event access is driven by the event status plus its timestamps: the active-season project gallery, team details, voting, judging, and results stay closed until their own gate opens. Historical seasons remain public, and an inactive `Next season` shell is ready for organizers to configure and obtain board approval. Every visitor-facing season message — including the home-page announcement — is editable from the admin portal rather than hardcoded.

## Event Gates and Privacy

`server/utils/event-state.ts` resolves every gate once per request from the merged event settings and the active season:

| Gate | Open when |
| --- | --- |
| Submissions | Status is `not_started` or `in_progress`, the event is not `paused`, and `now <= end_timestamp + SUBMISSION_GRACE_MS` (deadline checks are skipped when `ENFORCE_DEADLINES` is off) |
| Team changes | Same submission gate; team creation, invitations, membership changes, ownership transfer, and disband all close with submissions |
| Voting | `voting_enabled` is on, the event is not `paused`, and the current time is inside the configured voting window (`voting_start_timestamp` through `voting_end_timestamp`; window checks are skipped when `ENFORCE_DEADLINES` is off) |
| Judging | `judging_open` is on, the event is not `paused`, and results are not published for a `finished` season unless `JUDGING_AFTER_PUBLISH` is on |
| Public gallery | Submissions have closed (`voting`, `finished`, or the event deadline passed) |
| Results | `results_published` is on |

**Gallery privacy rule:** until the event enters peer voting, the public project gallery and active-season team detail pages are hidden, even if the submission deadline has passed while the season is still marked in progress. The team list returns only the caller's own team, and a team detail request returns 404 unless the caller is a current member, a judge with judging access, or an administrator. Project drafts are always private to their members and judging staff. Past-season archives remain public because they are read through their own season and do not depend on the active-season gate.

Published results are an explicit action. Publishing writes `results_published_at` and a `results_snapshot` of the standings, freezes judging and voting by default, and sends a notification to the season's participants. A new season starts with every operational switch off; it copies only the schedule, theme, and rubric from the active season, never the previous voting, judging, results, visibility, or announcement state.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Framework | Nuxt 4 |
| UI | @nuxt/ui (Tailwind CSS v4) |
| Language | TypeScript |
| Runtime | Node.js >= v24 (VPS); Bun 1.3.14 is also supported |
| Package Manager | Bun 1.3.14 or npm |
| Database | PostgreSQL via Drizzle ORM (`postgres` driver) |
| Auth | basis-auth OIDC with encrypted HTTP-only token cookies |
| OIDC | openid-client + jose |
| Validation | Zod 4.x |
| Fonts | @nuxt/fonts (local provider) |
| Icons | `@nuxt/icon` + `@iconify-json` (fluent, heroicons, lucide, material-symbols, simple-icons) |
| Linting | @nuxt/eslint + Oxfmt |
| Animation | GSAP with ScrollTrigger (showcase pages) |

## Season Showcases

The public `/showcase` page collects the season showcases in one place. The current featured experience, Beneath the Surface, lives at `/showcase/beneath-the-surface`; the previous Signal experience lives at `/showcase/signal`. Beneath the Surface loads archived project metadata from `/api/teams?season_id=1` and presents the top three Junior and top three Senior projects as six full-screen, project-specific chapters. GSAP and ScrollTrigger provide the desktop scroll choreography, while mobile and reduced-motion visitors receive a natural, non-pinned reading experience.

The showcase index also lists completed previous seasons and links to a dynamic project archive for each one. The archive reads submitted project names, descriptions, demo links, repository links, and published ranks from the season-specific public API. Upcoming blank seasons do not appear as past archives.

### Historical project data audit

The verified local SQLite candidate `database/basishacks.sqlite` passes `PRAGMA integrity_check` and contains 93 teams, including 71 non-empty project descriptions. A read-only comparison by team ID found all 93 teams and all 71 descriptions in the configured PostgreSQL database with matching values. The descriptions were missing from the public archive view: the old showcase linked only its curated pages. No team import or overwrite was needed. The one-time importer copies `project_description` when present and refuses to run against a populated target. Non-team differences in the legacy season, hackathon, and user records remain for review; do not reconcile them by rerunning the importer.

## Prerequisites

- **Node.js** >= v24 for the primary VPS runtime; **Bun** v1.3.14 is also supported
- Install dependencies with Bun 1.3.14 or npm
- A PostgreSQL database reachable through `DATABASE_URL`

## Installation

Clone [`@basis/schema`](https://github.com/biszdevelopers/basis-schema) beside this repository. Nuxt and Vitest resolve its source through local aliases; no Bun link is required.

```bash
git clone https://github.com/biszdevelopers/basis-schema.git ../basis-schema
bun install
```

If both repositories already exist in the same parent directory, run `bun install`. The `postinstall` script generates the server icon bundle and Nuxt's typed references when development icon collections are installed. Production-only installs skip source preparation and use the already-built Nuxt output.

## Environment Setup

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

The canonical list of variables lives in `.env.example`. The table below summarizes which are required and which are optional.

| Variable | Required? | Purpose |
| --- | --- | --- |
| `BASIS_AUTH_COOKIE_SECRET` | Required | Session and token-record encryption key. Must be at least 32 bytes. Generate with `openssl rand -base64 32` |
| `BASIS_AUTH_ISSUER` | Required | Exact basis-auth issuer URL used for discovery and token validation |
| `BASIS_AUTH_CLIENT_ID` | Required | Confidential client ID registered for nethack |
| `BASIS_AUTH_CLIENT_SECRET` | Required | Confidential client secret; keep it server-side |
| `BASIS_AUTH_RESOURCE` | Required | Resource audience for nethack access tokens (`devconnect://nethack.bisz.dev`) |
| `BASIS_AUTH_RESOURCE_SECRET` | Required | Resource secret issued by basis-auth; signs the backchannel webhook proof and authenticates private listener calls |
| `BASIS_AUTH_INTERNAL_URL` | Required | basis-auth private listener origin used for webhook verification and user-state checks (default listener `http://127.0.0.1:3001`) |
| `DATABASE_URL` | Required | PostgreSQL connection URL used in development, CI, and production |
| `DATABASE_POOL_MAX` | Optional | Connection pool maximum (default `10`, accepted range `2`–`64`) |
| `YAML_SOURCE_HACKATHON` | Optional | `local` or blank reads `HACKATHON.yml`; an assets origin or full asset URL selects a remote manifest; `database` uses PostgreSQL live settings. The manifest seeds and is compared against live settings, but every editable event field is stored in PostgreSQL and can be changed from the portal regardless of manifest location. |
| `HACKATHON_CONFIG_PATH` | Optional | Local manifest read as a seed and comparison source (default `HACKATHON.yml`) |
| `DATABASE_METRICS` | Optional | Set to `1` to log bounded PostgreSQL query and pool-acquisition timing summaries once per minute |
| `DATABASE_SLOW_QUERY_MS` | Optional | Slow-query log threshold in milliseconds when `DATABASE_METRICS=1` (default `250`) |
| `INITIAL_ADMIN_EMAILS` | Optional | Comma-separated bootstrap administrator allowlist. When unset, the built-in list is used. Matching is case-insensitive and re-applied at sign-in, so remove an address here before demoting that account |
| `REQUIRE_VERIFIED_EMAIL` | Optional | Require a verified `email_verified` claim at login (default off; an explicit `false` is always rejected) |
| `TEAM_INVITE_TTL_DAYS` | Optional | Team invitation lifetime in days, 1–365 (default `7`) |
| `PROFILE_UPDATE_DEADLINE_MS` | Optional | Deadline for reading a profile-update body in milliseconds (default `30000`) |
| `ENFORCE_DEADLINES` | Optional | Enforce the submission and voting deadlines in addition to the status switches (default on; set to `0` for an untimed rehearsal) |
| `SUBMISSION_GRACE_MS` | Optional | Grace period after `end_timestamp` for last-minute submissions (default `0`) |
| `JUDGING_AFTER_PUBLISH` | Optional | Keep judging open after results are published in a finished season (default off) |
| `HEALTH_DETAILS` | Optional | Include uptime in `GET /api/health/live` (default off; never includes database details) |
| `CURRENT_URL_ORIGIN` | Required | Public origin used to generate canonical URLs, derive `/api/auth/basis/callback`, and validate cookie-authenticated mutations. Loopback HTTP origins are accepted only while the server binds to loopback; `bun run start` does this and uses the matching port when `PORT` / `NITRO_PORT` is unset. The callback must be registered in basis-auth |
| `BASIS_AUTH_PICTURE_CACHE_DIR` | Optional | Local cache directory for basis-auth avatars (default: `assets/basis-auth-pictures`) |
| `DEEPSEEK_API_KEY` | Optional | DeepSeek API key for AI chat features (debug routes only) |
| `PORT` / `HOST` | Optional | Server port/host override (defaults: `3000` / `0.0.0.0`) |
| `SQLITE_IMPORT_PATH` | Optional | SQLite backup path used only for the one-time SQLite-to-PostgreSQL import |
| `BASISHACKS_E2E_DATABASE_URL` | Optional, test-only | Separate loopback PostgreSQL URL for the disposable browser-test database named `basishacks_e2e`; the test harness never falls back to `DATABASE_URL` |
| `PLAYWRIGHT_BASE_URL` | Optional, test-only | Explicit loopback HTTP origin for the isolated browser-test server |
| `RATE_LIMIT_GENERAL_MAX` | Optional | General API rate limit, requests per minute (default: `1200`) |
| `RATE_LIMIT_AUTH_MAX` | Optional | Authentication endpoint rate limit, attempts per minute (default: `200`) |
| `RATE_LIMIT_VOTE_MAX` | Optional | Voting/scoring endpoint rate limit, submissions per minute (default: `300`) |
| `RATE_LIMIT_UPLOAD_MAX` | Optional | File upload endpoint rate limit, uploads per minute (default: `100`) |
| `RATE_LIMIT_REQUEST_GATE_MAX` | Optional | Process-wide pre-body request gate, requests per minute per IP (default: `6000`) |
| `RATE_LIMIT_BACKCHANNEL_MAX` | Optional | basis-auth backchannel receiver limit, requests per minute (default: `600`) |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate limit window in milliseconds (default: `60000`) |
| `TRUSTED_PROXY_HOPS` | Optional | Exact trusted proxy count (0–10); configure only when each proxy appends the actual peer address to `X-Forwarded-For` |
| `BACKUP_DIR` | Optional | Backup output directory used by `bun run db:backup --with-assets` and the supplied timer (default `/srv/backups/basishacks`) |
| `BACKUP_RETENTION_DAYS` | Optional | Backup retention in days (default `14`) |
| `BACKUP_RSYNC_TARGET` | Optional | Off-box rsync destination for a completed backup |
| `DISABLE_DEBUG_ROUTES` | Optional | Set to a truthy value to disable `/api/debug/*` and `/debug` outside production; production disables them automatically |

For production, set `CURRENT_URL_ORIGIN=https://nethack.biszweb.club` in the deployment `.env`. Canonical page URLs and the basis-auth callback are derived from that value; register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` on the confidential nethack client in basis-auth.

## Authentication

The only login method is the separately deployed **basis-auth** service. `/api/login` discovers the issuer and starts an authorization-code flow with S256 PKCE, state, and nonce. The callback URL is always `${CURRENT_URL_ORIGIN}/api/auth/basis/callback`; it must be registered exactly for each environment. Resource-token claims and delegated permissions use the shared `@basis/schema` package; hackathon participant, judge, and administrator roles remain local.

Initial administrators come from `INITIAL_ADMIN_EMAILS`; when it is unset, a built-in fallback list is used. Matching is case-insensitive and elevation is re-applied when that address signs in, so remove the address from the allowlist before demoting the account. Existing administrators can promote or demote other users through `PATCH /api/users/:id/admin`; self-demotion is rejected, and both demotion and user deletion fail with `403` when no administrator would remain. Administrators are judges automatically. Participants are not judges by default: an administrator promotes one through `PATCH /api/users/:id/judge`, or creates a judge assignment, which promotes the participant and grants judging permissions on the next session refresh. A bulk user deletion is also rejected with `409` if it would leave a team without members; delete the team first so every remaining team stays manageable. With `REQUIRE_VERIFIED_EMAIL` enabled, an omitted `email_verified` claim is rejected; an explicit `false` is always rejected. A token with no granular `nethack.*` grant receives the normal participant bundle, so identity-only basis-auth clients still work without granting judge or administrator access.

The authorization request targets the configured `BASIS_AUTH_RESOURCE` and requests `openid profile email offline_access`. Feature authorization is not represented by OAuth scopes: basis-auth supplies a JWT `permissions` array, and nethack checks the least-privilege `nethack.*` permission required by each protected route. `nethack.all` is the explicit administrative grant. During the role-to-permission migration, legacy `participant`, `judge`, and `admin` grants are expanded into their equivalent granular permissions at the authorization boundary. After validating the ID token and UserInfo, nethack uses the issuer and subject for returning users and the basis-auth UserInfo email to match an unlinked account on first login. Avatars use the picture URL supplied by basis-auth at login, while profile theme images can still be uploaded locally. The callback then seals the access and refresh tokens into a compressed AES-256-GCM HTTP-only cookie. Browser JavaScript cannot read the token cookie. `GET /api/auth/session` validates the access token and returns only the user ID, expiry, and permissions for display-only UI gating; protected APIs independently validate either the cookie-held token or an explicit bearer token. When the access token nears expiry, the server rotates tokens and reseals the cookie. `POST /api/auth/logout` attempts refresh-token revocation and always clears the browser credential.

Protected application APIs validate basis-auth RS256 access tokens from the encrypted HTTP-only token cookie or an explicit `Authorization: Bearer …` header. The separate browser session cookie alone is insufficient. Tokens must match the configured issuer and resource audience, use `typ=at+jwt`, and must not be present in the revocation denylist or issued before a backchannel logout. The verifier also rejects disabled basis-auth users by asking the private listener; that lookup fails closed and is cached for one minute. Every invalid token gets the same public response: HTTP 401 with `WWW-Authenticate: Bearer error="invalid_token"` and the `Invalid access token` description. Failed requests use `Accept` negotiation: clients accepting `text/html` receive the shared Barry error page showing only the canonical error code, while other clients receive the `@basis/schema` JSON envelope `{ status, code, error, error_description }` with matching HTTP and envelope status values.

`POST /api/auth/basis/backchannel` is the resource's single backchannel logout receiver. basis-auth verifies that URL with an `action=test` challenge before saving it, and authorization-code sign-in fails with `14408 invalid_resource` while no verified URL exists. The same endpoint accepts `logout_token` events, which invalidate every local session for the subject, and `action=revoke_access_token` events, which denylist an access-token `jti` from its signed `valid_after` time. Register `${CURRENT_URL_ORIGIN}/api/auth/basis/backchannel` as the resource's backchannel logout URL in basis-auth. Because the URL must be reachable from the basis-auth server, a localhost development server cannot satisfy a remote issuer: register the deployed origin, then sign in locally. See [environment setup](documentation/guide/environment-setup.md) for the `14408` troubleshooting steps.

The former nethack OAuth provider and application-management UI/API have been retired. The legacy `oauth2_applications` table and records remain for audit and rollback. The Microsoft Graph integration, its ROPC credentials, and both Graph webhook handlers have been removed; the two webhook paths now return `404`.

## Live hackathon configuration

The live event's status, schedule, theme, announcement, voting, judging, results, score/rank visibility, vote cap, and member limit are stored in PostgreSQL. The manifest seeds new installations and provides comparison values, but the portal never writes it, so every editable setting applies immediately even when the manifest is hosted remotely. Set `YAML_SOURCE_HACKATHON=local` in `.env` for development. On the VPS, set it to the assets server origin or the full HTTPS URL of the published manifest. PostgreSQL still stores the active season selection, historical seasons, and competition data. A successfully fetched remote manifest is backed up to `assets/hackathon-config.yml`; if the assets server is unavailable, the app serves that backup, then the bundled `HACKATHON.yml`, so the assets server is not a hard dependency.

The administration page separates **run the season** from **season settings** and from **site-wide settings**. Running a season is a sequence of explicit actions: open submissions, open peer voting and judging, publish results, and finish. Season settings are one form with one Save button covering the schedule, theme, announcement, vote cap, and results visibility; the page no longer autosaves one field at a time. The team limit and year rubric are managed beside the season, while the award catalog is site-wide. Publishing results freezes judging and voting by default and writes `results_published_at` plus the standings snapshot; set the switches explicitly in the same request to reopen them.

Startup creates an inactive `Next season` shell with event switches off and no copied theme, schedule, or rubric. The SQLite importer also recognizes targets that still contain the legacy `R1 2026–2027` shell as the same pristine seed state. The portal supports both settings-copy seasons and blank seasons. A settings-copy season receives only the active season's schedule, theme, and an immutable copy of its rubric; every operational switch starts off. A blank season cannot be activated until its theme, event and voting dates, and season rubric are configured. Organizers must also obtain board approval before activation. The per-season `max_team_members` value (1–20) sets the roster cap for that season.

For an existing deployment, run `bun run db:export-hackathon -- /path/to/HACKATHON.yml` once to export the legacy PostgreSQL row. The command requires `DATABASE_URL` and creates a new file. Use the repository's [configuration and cutover instructions](documentation/deployment/postgresql-migration.md#move-the-live-hackathon-configuration-to-yaml) to deploy it.

## Database Setup

The PostgreSQL database auto-migrates on server startup. The init plugin `server/plugins/init-database.ts` creates the bounded `postgres` connection pool and applies Drizzle migrations under a PostgreSQL advisory lock before the server accepts requests. It then seeds the default event, first season, next-season shell, and rubric; generated season IDs use the PostgreSQL serial sequence, and `seasons.rubric_version_id` is protected by a foreign key. Configure a valid `DATABASE_URL` in every environment. The default pool maximum is 10 connections; `DATABASE_POOL_MAX` accepts validated values from 2 to 64. Application connections use a 15-second `statement_timeout`, a 30-second idle-in-transaction timeout, and a 20-second idle timeout. Migrations run on a dedicated two-connection migrator client with no statement timeout, so a large DDL batch is not aborted; the SQLite importer sets a 5-second `lock_timeout` before taking the same advisory lock.

Migration `0015` adds `admin_audit_events`, `judge_assignments`, `judge_recusals`, and `notifications`, plus team ownership/status/`submitted_at`/`score_exact`, season `results_published_at`/`results_snapshot`, and stricter foreign keys and check constraints. Migration `0016` adds `judge_flags`, per-season `max_team_members`, invitation `token`/`expires_at` with a seven-day backfill, and `teams.project_video_url`. Migration `0017` adds peer-voting team provenance. Migration `0018` adds the local `users.is_judge` flag. The migrations normalize legacy rows before adding constraints; take a verified snapshot before applying them to a populated database.

Before manually reconciling a populated PostgreSQL database, create a verified custom-format snapshot with `bun run db:backup -- --output .tmp-postgres-before-change.dump`. The command reads `DATABASE_URL` from `.env`, forces `pg_restore` through every data block before publishing the file, refuses to overwrite an existing backup, and keeps an explicit snapshot path inside the gitignored workspace.

`bun run db:audit-sqlite` performs a read-only comparison of the configured SQLite candidate and PostgreSQL rows by key and field. Its current audit found the historical team/project descriptions already present in PostgreSQL; it makes no writes. It also reports conflicting legacy user, season, and singleton fields for review rather than choosing a value automatically. Take and verify a PostgreSQL snapshot before any future reconciliation.

The VitePress site builds with Nuxt and is served at `/docs/` through authenticated Nitro routes. Every page and asset requires judge or administrator permission. The docs link appears only in the admin portal, which embeds the same site at `/developers/docs` and offers an **Open in new tab** action for the standalone route. The docs keep `/docs/` working directly and include a **Portal** link when embedded (or **Home** when standalone) that returns the outer window. Keep generated docs outside Nuxt `public/` so they cannot bypass the access check. The docs theme uses the same Monaspace Neon font and dark palette as the application; the webfont lives in `documentation/public/fonts/` and is copied into the protected build output.

Application queries use Drizzle ORM's parameterized query builders. `bun run db:migrate` applies pending PostgreSQL migrations for release workflows; server startup also applies pending migrations before serving.

For manual schema management (e.g., generating migration files after editing `server/database/schema.ts`), Drizzle Kit is available:

```bash
bun run db:migrate    # apply pending PostgreSQL migrations
bun run db:generate   # generate new migration from schema changes
bun run db:studio     # open Drizzle Studio
```

### Importing an existing SQLite database

SQLite files are not used by the application at runtime. To migrate an existing deployment, take and verify a SQLite backup, provision a new PostgreSQL database, stop the app, apply migrations, then run the one-time importer. The importer accepts an empty target or the complete exact seed from fresh migrations; it rejects partial or modified seed rows and other target data by default. The explicit `--preserve-matched-user` option supports a pristine seed plus one basis-auth user whose email, issuer, and subject match the SQLite source. It preserves IDs and relationships, normalizes safe epoch timestamps stored with a zero fraction, maps nullable legacy sourcing text to an empty value, imports legacy `sc_votes`, adds an immutable imported rubric version per season, archives removed legacy fields, checks foreign-key relationships and row counts, and rolls back the entire import on failure. The earlier single-hackathon schema is mapped to one explicit season; retired one-time login credentials are discarded. Unknown non-metadata tables and broken source references fail closed; the importer reads the SQLite source without modifying it. Retired `basis_auth_sessions` rows are counted but their credentials stay in SQLite. The importer preserves `legacy_schema_compat_archive` rows, including their original keys, payload text, and timestamps, in `sqlite_legacy_data`. See [SQLite-to-PostgreSQL migration](documentation/deployment/postgresql-migration.md) for the maintenance-window procedure.

## Judging and Published Feedback

Judges score one project at a time against the season's versioned rubric whenever the organizer has enabled `judging_open` and the event is not `paused`. Publishing results closes judging for a `finished` season unless `JUDGING_AFTER_PUBLISH` is enabled. A participant whose current team competes in the season cannot judge that season, a judge's former teams are excluded, and promoting a competing participant to judge is rejected. Peer voting follows the same pattern through `voting_enabled`, and a configured voting deadline closes it unless `ENFORCE_DEADLINES` is off; the current-season gallery opens only when the event enters peer voting or finishes. Only teams with `status = 'active'` can vote, and ballots from teams later withdrawn or disqualified are excluded from the results and turnout. `max_votes_per_user` caps how many projects may receive stars. Judge assignments can narrow a judge to a pathway or a team, and a recusal removes that team from the judge's queue. The full-width judging workspace lists every competitor-submitted field — team, pathway, project name, description, AI-use disclosure, repository, demo, and submission status — in a left pane, with an explicit "Alixa did not provide…" label for missing values instead of blank space. Descriptions and disclosures render through `SafeComark`, which parses Markdown with raw HTML disabled and preserves single newlines. Scoring sits in a right pane separated by a draggable, keyboard-operable divider; both panes scroll independently on wider screens and stack on mobile. A project navigator lists the whole queue with scored state and filters, and **Next unscored** jumps straight to unfinished work. After a final submission the workspace re-reads the current queue page and the progress summary from the server, so a committed evaluation is never reported as unscored and the next-unscored jump always follows stored state. Drafts save automatically, and the judge reviews the evaluation in a dialog before final submission. Completed evaluations stay available in a read-only history page for every season, including after judging closes; an evaluation whose immutable rubric is missing still shows its project details, AI-use disclosure, and written feedback with an explicit unavailable-score state. The same AI-use disclosure is shown in the dashboard project card, voting card, past-season archive, public results feedback panel, and administrator team-review modal. Finalized scores use the arithmetic mean of each judge's normalized weighted rubric score. After results are published, current and past team members can read anonymous written feedback once at least three judges have evaluated their team; before then, the interface explains the anonymity gate without exposing an exact review count. Individual judge score breakdowns and identifiers are omitted, and feedback order is randomized. Public score and rank details also stay hidden until at least three judges have evaluated the team; scores additionally require `show_scores`, and ranks require `show_ranking`. Administrators can inspect full evaluations with judge identities.

Each immutable rubric version also stores its own judge-comment introduction, guidelines, and editable prompt templates. Organizers can configure these in the season rubric editor; copying a prior-season rubric or reusable template carries its guidance forward. Legacy rubric versions use the built-in defaults. Final submission rejects a comment containing the judge's exact email address or display name, with an inline correction message; this conservative check does not identify indirect clues or alternate spellings.

Draft reads, autosaves, and deletes share a separate per-judge limit of 1200 requests per minute by default. This uses `RATE_LIMIT_GENERAL_MAX` and `RATE_LIMIT_WINDOW_MS`, leaving headroom for the 650 ms autosave debounce.

Organizers can choose a season-specific score display curve (`original`, `gentle`, `moderate`, or `strong`). A curve changes only the displayed score: persisted scores and rankings remain unchanged. The curve cannot be changed after results are published. The admin team view can inspect full score feedback with judge identities before or after results are published.

Team score cards link to `/seasons/:id`, where participants and organizers can review that team's season schedule and theme. Future and paused season themes remain hidden until the event begins.

Final submission requires a demonstration video URL and an AI-use disclosure; the disclosure may be the explicit "No AI tools or models were used in this project." option. The form shows a submission checklist and requires an acknowledgement before the irreversible submit action, which records `submitted_at`. Only an active, unsubmitted team can submit, and the write touches only the submission columns so a concurrent disband or withdrawal is never reverted. An administrator can reopen a submission only before results are published, only after its evaluations and the season's peer votes have been deleted; reopening also recomputes every remaining team's stored rank.

Each participant has one active-season team. A `team_id` left over from an earlier season is returned as history in `past_teams`, not as the current team, so a returning participant can join the new season normally. Teams have an owner who controls renaming, invitations, and removal; ownership can be transferred to another current member. Disbanding withdraws the team, detaches its members, records past-team history, and leaves the row for archives and results.

Invitations appear in the invitee's in-app notifications when they already have an account, and also produce a single-use link containing a 64-character bearer token that can be shared with someone who has not signed in yet. Only the SHA-256 digest is stored. Links expire after `TEAM_INVITE_TTL_DAYS` (default 7) and can be revoked; accepting a token is refused once submissions close. The dashboard bell and `/notifications` page show team invitations, accepted invitations, results publication, and judge conflict flags for administrators.

## Voting and Results

Each participant's peer ballot is stored per user and season, so a returning participant votes again without overwriting the previous ballot. Ballots also store the voting team that cast them; legacy ballots without that provenance are excluded from aggregation rather than reattributed to the voter's current team. People's Choice aggregates **one unit per voting team**: each team's ballots are averaged, then those unit values are averaged across every team that voted. Turnout counts submitted projects, voting teams, and ballots. Peer results are available only after voting closes, and the People's Choice view additionally requires results to be published for the active season unless the caller has judging access.

The public `/results` page shows a locked state until `results_published`. The dashboard results page lists the participant's current and past teams, and each `ScoreCard` applies that team season's publication and visibility rules; the certificate page is separately gated on publication. The page shows standings and ranks, team awards, project cards, and the People's Choice summary. Printable certificates are available at `/certificate/:id` once the team's season has published results. The public rubric endpoint and the `/seasons/:id` page expose the active tracks and criteria. `/api/ballot/results` returns the peer aggregate with turnout, and `/calendar.ics` publishes the scheduled event milestones as an RFC 5545 calendar.

## Event Operations

Administrators manage awards, the audit log, judge coverage and flags, and event preflight from the mod portal. Awards can be defined by namespace and assigned to teams; results publication controls when participants see them. The audit log records administrative mutations with actor, entity, before/after values, optional reason, and request ID. Preflight reports submitted-team counts, teams below the three-evaluation feedback minimum, judge coverage, publication mismatches, vote-cap feasibility, and the current gates. Standings can be exported as CSV with exact scores and ranks.

Administrators can void a single judge evaluation, change a team's status to `withdrawn`, `disqualified`, or `no_show`, reopen a submission, or resolve a judge flag. Voiding and status changes recompute standings in the same transaction and write an audit row. The judge coverage page creates per-season pathway or team assignments and lists open conflict flags with the reporting judge's identity.

## Health, Backups, and Logging

Startup fails fast: missing production configuration, invalid `CURRENT_URL_ORIGIN`, or an unavailable database stops the process instead of serving a half-configured app. `GET /api/health/live` reports only that the process answers; `GET /api/health/ready` returns `503` unless PostgreSQL answers `select 1` within two seconds. Neither endpoint requires authentication. The supplied systemd units use `OnFailure=basishacks-failure@%n.service`, a bounded start-limit burst, and a separate daily backup service/timer at 03:15 with a 15-minute randomized delay.

`bun run db:backup --with-assets` writes a custom-format `pg_dump`, verifies it with `pg_restore`, stores a SHA-256 checksum, sets mode `0600`, archives the runtime `/assets` directory, and prunes snapshots older than `BACKUP_RETENTION_DAYS`. `BACKUP_RSYNC_TARGET` copies the result off-box. Restore a snapshot with `pg_restore` against a stopped application, then restore the matching assets archive before serving.

Every request gets an `x-request-id` (a bounded caller value or a generated UUID), which is echoed in the response and included in JSON request and error logs. Static assets are skipped. 5xx logs contain route, method, status, request ID, and bounded messages; they never include SQL text, parameters, cookies, or credentials. The error response itself is sanitized. `DATABASE_METRICS=1` adds bounded PostgreSQL timing summaries and slow-query lines above `DATABASE_SLOW_QUERY_MS` without SQL text.

## Development

```bash
bun dev --https        # HTTPS on port 24598
npm run dev -- --https # or with npm
```

For HTTP (not recommended — OAuth2 requires secure context): `bun dev`

The custom Nitro error-handler path is normalized to forward slashes in `nuxt.config.ts`. This keeps the generated virtual module valid on Windows, including when the absolute project path contains digit-leading username segments that JavaScript could otherwise parse as legacy octal escapes.

## Testing

```bash
bun run test            # full suite (also generates tests/.test-meta.json)
bun run test:watch      # watch mode
bun run test:coverage   # enforce 100% executable source coverage
bun run lint            # ESLint across app, server, shared, tests, e2e, scripts
bun run typecheck       # Nuxt/vue-tsc strict type check
bun run test:e2e:oidc   # protocol and security tests for the isolated test issuer
bunx playwright install chromium
bun run build
# Set BASISHACKS_E2E_DATABASE_URL to the dedicated basishacks_e2e database and
# PLAYWRIGHT_BASE_URL to an explicit loopback origin in .env, then run:
bun run test:e2e        # Chromium role, route-sweep, and responsive browser journeys
```

To capture the synthetic board walkthrough, configure that same isolated database and app origin in `.env`, install Chromium and FFmpeg with its `libflite` filter, then run `bun run demo:capture` followed by `bun run demo:render`. Capture refuses to use `DATABASE_URL`; it requires a separate loopback database named `basishacks_e2e`. The offline narration is synthesized by FFmpeg, so it works without an installed operating-system voice or external service. The narrated 5–7 minute MP4, 30–45 second GIF, and transcript are written under `artifacts/board-demo/`.

The canonical test count is stored in `tests/.test-meta.json` and displayed dynamically in the VitePress documentation. Coverage enforces 100% statements, branches, functions, and lines for instrumented `.js`, `.mjs`, and `.ts` files under `app/`, `server/`, `shared/`, and `scripts/`, plus the production launcher and Drizzle config. It verifies per-file counters and merges the client and server builds for compile-time branches. Vue single-file components and CSS are not runtime-instrumented; source-contract checks do not replace rendered browser journeys or viewport accessibility checks.

Browser tests require a production build, Chromium installed for Playwright, and a dedicated PostgreSQL database named exactly `basishacks_e2e`, configured as `BASISHACKS_E2E_DATABASE_URL`. The harness refuses other database names, starts the built app and an isolated OIDC issuer on loopback, and never adds a production test-login route. It does not fall back to the app's `DATABASE_URL`. CI creates the isolated database and installs Chromium on its temporary runner.

Do **not** use `bun test` — it cannot resolve Nuxt path aliases. `bunfig.toml` redirects it to a guidance shim.

## Performance Measurement

The Linux benchmark harness at `scripts/benchmark-vps.mjs` reports process RSS, service cgroup memory, request throughput, per-target p50/p95/p99 latency, errors, CPU use, and PostgreSQL query/pool timings. Load runs require cgroup and database-metrics inputs so the release gate cannot silently skip those measurements. Set `DATABASE_METRICS=1` on the app service to emit bounded timing summaries. Follow the [VPS measurement workflow](documentation/deployment/performance.md) for the five-minute warm-up and idle runs, repeated cold starts, 250-user soak, and `main` baseline comparison; Linux measurements remain a release gate.

Runtime query paths avoid N+1 work with per-request memoized lookups, batched evaluation counts, and a single `UPDATE ... FROM (VALUES ...)` statement per 250-team scoring batch. Standings use exact scores plus rubric tiebreak, submission time, and team ID, and assign competition ranks so tied projects share a rank. `GET /api/teams` and `GET /api/judging/history/:seasonId` accept optional `limit` (1–50) and `after` keyset parameters; without `limit` they keep their previous full-array response. `GET /api/admin/database/export` streams inside a repeatable-read, read-only transaction instead of building the export in memory.

## Building & Production

```bash
git clone <repository-url> /opt/basishacks/current
cd /opt/basishacks/current
bun install --frozen-lockfile
# Configure required production environment variables before starting.
bun run build
bun run db:migrate
bun run start
# `bun run start` uses the configured `CURRENT_URL_ORIGIN` port and binds to
# 127.0.0.1 when it is a loopback HTTP origin and no explicit values are set.
# On Linux VPS hosts, `npm run start` uses the same POSIX runtime selector.
# It prefers Bun 1.3 or newer and falls back to Node.js 24 or newer.
# To explicitly use Node.js after building the same checkout:
node start-fix.mjs
```

Keep the same checkout for `git pull`, build, and start so its ignored `/assets` upload directory persists. The optional release-packaging workflow is still available for archive-based deployments; when replacing a checkout, preserve or restore `/assets` first. Both Bun and Node.js run the same generated server.

Place a reverse proxy (Nginx, Caddy) in front for TLS termination. Keep PostgreSQL data separately persistent. Runtime uploads live in the project-root `/assets` directory, which is gitignored: in-place `git pull`, build, and start deployments preserve it. Back it up separately, and preserve or restore it before serving after a re-clone. The committed showcase files in `public/assets` are separate from runtime uploads. Hardened systemd examples for either runtime are available under [`deploy/systemd/`](deploy/systemd/).

For Nginx, include [`deploy/nginx/basishacks-request-limits.conf`](deploy/nginx/basishacks-request-limits.conf) inside the application site's `server {}` block. The app caps ordinary API request bodies at 1 MiB, lets the authorized profile handler read up to 10 MiB for profile updates, and reads that body against `PROFILE_UPDATE_DEADLINE_MS` (default 30 seconds) while allowing at most one profile update per app process before buffering or decoding images. Additional simultaneous profile updates receive `503 Service Unavailable` with `Retry-After: 2`. The removed Graph webhook paths now return `404`.

Runtime files are stored in the project-root `/assets` directory. Profile images use SHA-256 content-addressed names under `/assets/userassets/profiles/`, so identical image bytes with the same canonical extension share one object. Replacing a profile theme deletes the superseded object immediately when nothing else references it, so repeated uploads cannot accumulate files between cleanups. Basis-auth avatars are cached under `/assets/basis-auth-pictures/` and served from that local backup if the provider is unavailable. Daily bounded cleanup considers remaining managed profile objects after at least seven days and removes one only after an advisory-locked PostgreSQL check confirms that it has no profile-picture, profile-theme, or legacy OAuth application picture references. Debug uploads have been retired. Existing files remain accessible at their original `/assets/uploads/*` and `/userast/*` URLs. The application no longer schedules cleanup of debug permalink files.

## Deployment

1. Build on the server: `bun run build`
2. Set all required environment variables in the server environment
3. Start with `bun run start` or, on Linux, `npm run start` (selects Bun 1.3 or newer when available, otherwise Node.js 24 or newer), or use `node start-fix.mjs` to explicitly choose Node.js
4. Reverse proxy with TLS in front (port defaults to `3000`)

### GitHub tag releases

Pushing a tag beginning with `v` runs `.github/workflows/release.yml`. It first verifies the tag is an ancestor of `main`, then runs dependency audit, type check, lint, the full test suite, and the 100% coverage gate. It builds a VPS artifact with the Nuxt server, portable runtime dependency paths, PostgreSQL migrations, migration/import commands, and production dependencies installed from the lockfile, and verifies the extracted archive under Node.js and Bun against PostgreSQL. Release assets include a SHA-256 checksum. CI also runs a gitleaks secret scan and publishes an SPDX SBOM; `.github/dependabot.yml` opens grouped weekly npm updates plus monthly documentation, GitHub Actions, and Docker updates. Workflow actions are referenced by major tag in the file and should be pinned to a full commit SHA when bumped, because tags are mutable. Client source maps are disabled in production.

The recommended VPS flow is to keep a direct checkout and run `bun run build` followed by `bun run start`. If using the optional release archive, preserve or restore project-root `/assets` before serving; back it up separately from PostgreSQL. The committed showcase files in `public/assets` remain separate from runtime uploads.

## API Surface

The full endpoint reference is in [`documentation/backend/api-reference.md`](documentation/backend/api-reference.md). Event and participant additions:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ballot/results` | Peer-vote aggregates and turnout; requires closed voting and published results for public callers |
| `GET` | `/api/notifications` | Caller's notifications and unread count |
| `PATCH` | `/api/notifications/:id/read` | Mark one notification read |
| `PATCH` | `/api/notifications/read-all` | Mark every notification read |
| `POST` | `/api/team-invites/token/:token/accept` | Accept an invitation by bearer token |
| `PATCH` | `/api/teams/:id/owner` | Transfer team ownership |
| `DELETE` | `/api/teams/:id` | Disband and withdraw a team |
| `POST` | `/api/judging/recusals` | Record a conflict recusal |
| `POST` | `/api/judging/flag` | Report a conflict flag to organizers |

Administrative additions:

| Method   | Path                                   | Purpose                                 |
| -------- | -------------------------------------- | --------------------------------------- |
| `GET`    | `/api/admin/awards`                    | List award definitions                  |
| `POST`   | `/api/admin/awards`                    | Create or update an award               |
| `DELETE` | `/api/admin/awards/:namespace`         | Delete an award                         |
| `GET`    | `/api/admin/teams/:id/awards`          | List a team's awards                    |
| `POST`   | `/api/admin/teams/:id/awards`          | Assign an award to a team               |
| `DELETE` | `/api/admin/teams/:id/awards/:award`   | Remove a team award                     |
| `GET`    | `/api/admin/audit`                     | Read the administrative audit log       |
| `GET`    | `/api/admin/preflight`                 | Event readiness checks and gate summary |
| `GET`    | `/api/admin/standings.csv`             | Season standings CSV                    |
| `GET`    | `/api/admin/judging/assignments`       | List judge assignments                  |
| `POST`   | `/api/admin/judging/assignments`       | Create a pathway or team assignment     |
| `DELETE` | `/api/admin/judging/assignments?id=`   | Remove an assignment                    |
| `GET`    | `/api/admin/judging/flags`             | List judge flags                        |
| `PATCH`  | `/api/admin/judging/flags/:id`         | Resolve a judge flag                    |
| `DELETE` | `/api/admin/teams/:id/scores/:judgeId` | Void one evaluation                     |
| `PATCH`  | `/api/admin/teams/:id/status`          | Set withdrawn, disqualified, or no-show |
| `POST`   | `/api/admin/teams/:id/reopen`          | Reopen a submitted project              |

Operational routes: `GET /api/health/live`, `GET /api/health/ready`, `GET /calendar.ics`, `GET /.well-known/security.txt`, `GET /sitemap.xml`. `GET /api/teams` and `GET /api/judging/history/:seasonId` accept optional `limit` and `after` keyset parameters.

## Project Structure

```
app/                    # Vue frontend
server/                 # Nitro backend
  api/                  # API route handlers
  routes/               # Non-API routes (health, calendar, sitemap, security.txt, docs)
  middleware/           # Request ID, logging, rate gate, database context, CSRF and headers
  plugins/              # DB initialization and fail-fast environment validation
  database/             # PostgreSQL Drizzle ORM schema + advisory-locked migration runner
  utils/                # Auth, event gates, rate limiting, JWT, audit, notifications, etc.
shared/                 # Zod schemas, types, permissions, rubric, response contracts
tests/                  # Vitest suite
documentation/          # VitePress site
```

## Existing SQLite deployment

For an existing deployment with a SQLite database, follow the [SQLite-to-PostgreSQL migration procedure](documentation/deployment/postgresql-migration.md). The app no longer reads SQLite at runtime; the SQLite file must be imported into PostgreSQL before starting the new release. `bun run db:audit-sqlite` compares a populated PostgreSQL database with SQLite in read-only mode and writes a reconciliation report. Do not run the fresh-target importer against a populated database.

### Required authentication env vars

Set `BASIS_AUTH_ISSUER`, `BASIS_AUTH_CLIENT_ID`, `BASIS_AUTH_CLIENT_SECRET`, `BASIS_AUTH_RESOURCE`, `BASIS_AUTH_RESOURCE_SECRET`, and `BASIS_AUTH_INTERNAL_URL` in `.env`. Register `${CURRENT_URL_ORIGIN}/api/auth/basis/callback` with the same basis-auth client and `${CURRENT_URL_ORIGIN}/api/auth/basis/backchannel` as the resource's backchannel logout URL. The resource secret is shown once; rotate it in the basis-auth portal and update this deployment before the old value is retired.
