---
title: Project Overview
description: High-level overview of the basishacks hackathon platform, including features, technology stack, directory structure, and key concepts.
---

# Project Overview

**basishacks** is the official website for the **BIBS-C Network Hackathon** (season 2, 2025–26). It is a full-stack Nuxt 4 application that serves as the central platform for organizing and running the hackathon event.

## What basishacks Does

The platform manages the entire hackathon lifecycle:

| Feature | Description |
| --- | --- |
| **Hackathon Management & Scheduling** | Control event state (`not_started`, `in_progress`, `voting`, `finished`, `paused`), schedule start and end times, and manage the event timeline. |
| **Team Creation & Management** | Participants create teams, invite members via `@basischina.com` email, and manage team membership. |
| **Project Submission** | Teams submit projects with name, description, demo URL, repository URL, and sourcing information. Submissions are accepted only during `not_started` or `in_progress` states. |
| **Peer Voting** | Participants vote on projects by distributing 10 stars across eligible projects in the same pathway. The total must equal exactly 10. |
| **Judge Scoring** | Judges use season-specific, versioned weighted rubrics with track-specific criteria and integer score ranges. Guided comment prompts and templates help judges write useful anonymous feedback. |
| **Published Feedback** | Competitors can review anonymous comments after results are published and at least three judges have evaluated their team. Organizers can inspect full feedback, including judge identities, at any time. Configurable score curves change display only and preserve original scores and rankings. |
| **Mod Portal** | Administrative dashboard for managing users, teams, seasons, and debug tools. |
| **Graph API** | Independent meeting scheduling and Teams chat integration. It is not an authentication provider. |
| **DeepSeek AI Chatbot** | In-memory chat session store powered by the OpenAI SDK for DeepSeek AI interactions in debug routes. |
| **SafeLink / SafeComark Components** | Client-side components that sanitize user-provided links and markdown content, preventing XSS and open redirects in rendered project descriptions. |
| **Security Middleware** | A middleware pipeline including HTTP security headers (6 headers, 10 CSP directives), debug route lockdown (`DISABLE_DEBUG_ROUTES`), and rate limiting (4 tiers). |
| **Season Showcases** | Public, art-directed winner experiences, including the six-project Beneath the Surface showcase. |

## Technology Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| **Framework** | Nuxt 4 (^4.6.4) | Full-stack Vue framework with SSR and file-based routing. |
| **UI** | `@nuxt/ui` ^4.12.0 | Tailwind CSS v4 based component library. |
| **Language** | TypeScript (^6.0.3) | Strict typing throughout. |
| **Runtime** | Node.js >= v24; Bun 1.3.14 | Node.js is the primary VPS runtime; Bun is also supported. |
| **Package Manager** | Bun 1.3.14 or npm | Both can install the locked dependencies. |
| **Database** | PostgreSQL via Drizzle ORM | Bun and Node.js share the bounded `postgres` driver pool. |
| **Auth** | basis-auth OIDC | Encrypted HTTP-only token cookies; bearer tokens are also supported for service clients. |
| **JWT** | `jose` ^6.2.3 | JWT signing and verification for OAuth2 access tokens. |
| **AI** | `openai` ^6.45.0 | OpenAI SDK used for DeepSeek API integration. |
| **Validation** | Zod 4.x (^4.6.7) | Schema validation for all API inputs. |
| **Fonts** | `@nuxt/fonts` ^0.14.0 | Local font provider. |
| **Icons** | `@nuxt/icon` with fluent, heroicons, lucide, material-symbols, and simple-icons | Scanned client icons and a bounded server-rendered icon bundle. |
| **Animation** | `gsap` ^3.15.0 | ScrollTrigger timelines and responsive motion for the Beneath the Surface showcase. |
| **Linting** | `@nuxt/eslint` ^1.17.0 + Oxfmt ^0.78.0 | Semicolons enabled, double quotes. |
| **Deployment** | Node.js server (VPS) | Bun also supported; Nitro `node-server` preset. |

### Live Dependency Versions

The following tables are generated automatically from the root `package.json` during each VitePress build or dev server start. They reflect the exact dependency versions currently declared in the repository.

<PackageVersions />

## Authentication

Authentication is delegated to one provider:

### basis-auth

The browser uses basis-auth discovery and authorization code with S256 PKCE, state, nonce, a confidential client secret, validated ID tokens, and UserInfo. The first verified login can attach to an existing user by normalized email; repeat logins resolve by stable issuer and subject. Graph credentials are used only for independent Graph features.

## Roles & Permissions

### Core Roles

The app grants access through fine-grained permissions from basis-auth. The labels below describe the common participant, judge, and organizer workflows:

| Role | Description |
| --- | --- |
| `participant` | Default role. Can join teams, submit projects, and vote. |
| `judge` | Can score projects using the season rubric. Identity is hidden from competitors; organizers with the all-permissions grant can see it in the admin feedback view. |
| `admin` | Access depends on delegated basis-auth permissions, including the mod portal. |

### Fine-Grained Developer Permissions

The platform uses fine-grained basis-auth JWT permissions defined by `NethackPermissions` in `shared/permissions.ts`.

| Permission             | Description                            |
| ---------------------- | -------------------------------------- |
| `dev_users`            | Access to user management utilities.   |
| `dev_teams`            | Access to team management utilities.   |
| `dev_debug`            | Access to debug endpoints.             |
| `dev_deepseek`         | Access to DeepSeek AI features.        |
| `portal.users.view`    | View users in the mod portal.          |
| `portal.debug.view`    | View debug tools in the mod portal.    |
| `portal.teams.view`    | View teams in the mod portal.          |
| `portal.deepseek.view` | View DeepSeek tools in the mod portal. |
| `portal.seasons.view`  | View season management.                |
| `portal.seasons.edit`  | Edit seasons.                          |

`nethack.all` is an explicit administrative JWT permission that satisfies nethack permission requirements.

## Seasons System

The platform supports multiple hackathon seasons stored in the `seasons` table. Each season has:

- **Name**: the display name of the season.
- **Active status**: only one season can be active at a time (partial unique index on `is_active`).
- **Per-season configuration**: every hackathon config field is stored per season (`status`, `voting_enabled`, `judging_open`, `results_published`, `show_scores`, `show_ranking`, `max_votes_per_user`, `schedule_start`, `schedule_end`, all five timestamps, `theme_name`, `theme_description`). Seasons can override the global `hackathon` row, or fall back to it via defaults.

Teams are associated with a specific season via the `season_id` foreign key. The active season determines which teams and projects are displayed.

Season management happens through the `/api/seasons/` endpoints and the Hackathon Administration page at `/developers/season`. Editing tweaks (`status`, `show_scores`, `show_ranking`) on the live season also updates the `hackathon` row; `setActiveSeason` copies the newly active season's tweaks into the global row.

## Directory Structure

```
basishacks-r2/
├── app/                        # Nuxt app (Vue frontend)
│   ├── assets/css/             # Global styles (Tailwind + custom utilities)
│   ├── components/             # Vue components
│   │   ├── SafeLink.vue        # URL-aware link renderer with open redirect protection
│   │   ├── SafeComark.vue      # Safe markdown renderer using SafeLink for links
│   ├── composables/            # Vue composables (useApiUser, etc.)
│   ├── layouts/                # Nuxt layouts (default, dashboard, fullwidth, etc.)
│   ├── middleware/             # Route middleware (auth.ts)
│   ├── pages/                  # File-based routing
│   │   ├── dashboard/          # Dashboard pages (teams, general, results)
│   │   ├── developers/         # Admin/mod portal
│   │   │   ├── debug.vue       # Debug tools
│   │   │   ├── deepseek.vue    # DeepSeek AI chat interface
│   │   │   ├── season.vue      # Hackathon Administration (seasons + config)
│   │   │   ├── teams.vue       # Team management
│   │   │   └── users.vue       # User management
│   │   ├── user/               # User profile pages
│   │   ├── api/oauth2/         # OAuth2 authorize page
│   │   ├── judging/            # Judge scoring interface
│   │   ├── voting.vue          # Peer voting interface
│   │   └── showcase.vue        # Project showcase
│   ├── utils/                  # Frontend utilities (consts, errors, loading)
│   ├── app.config.ts           # App-level configuration
│   ├── app.vue                 # Root Vue component
│   └── error.vue               # Error page
│
├── server/                     # Nitro backend
│   ├── api/                    # API route handlers (file-based)
│   │   ├── admin/              # Admin endpoints (scores, teams)
│   │   ├── auth/               # basis-auth callback, token refresh, and logout
│   │   ├── ballot/             # Ballot and peer voting endpoints
│   │   ├── debug/              # Debug endpoints (DeepSeek sessions, existing file listings)
│   │   ├── seasons/            # Season management endpoints
│   │   ├── teams/              # Team CRUD, member management, scoring, submission
│   │   ├── users/              # User CRUD and profile pictures
│   │   └── _webhooks/          # Lifecycle and update webhooks
│   ├── middleware/             # Server middleware
│   │   ├── security-headers.ts # HTTP security headers (6 headers, CSP, HSTS, etc.)
│   │   ├── debug-lockdown.ts   # Disables debug routes in production via DISABLE_DEBUG_ROUTES
│   ├── database/               # Drizzle ORM schema, migration runner, and DB wrapper
│   │   ├── schema.ts           # Drizzle table definitions
│   │   ├── migrate.ts          # Custom migration runner, legacy schema repair, seeding
│   │   └── index.ts            # Bounded PostgreSQL pool and Drizzle instance
│   ├── plugins/                # Nitro plugins
│   │   ├── init-database.ts    # Database initialization and attach Drizzle to event context
│   │   ├── microsoft.ts        # MS Graph API token initialization and centralized API calls
│   │   └── validate-environment.ts # Session and basis-auth configuration guard
│   ├── types/                  # Type augmentations (H3EventContext, OAuth2 JWT)
│   └── utils/                  # Server utilities
│       ├── database/           # Per-table DB helpers
│       │   ├── awards.ts
│       │   ├── ballots.ts
│       │   ├── hackathon.ts
│       │   ├── members.ts
│       │   ├── peer-voting.ts
│       │   ├── scores.ts
│       │   ├── seasons.ts
│       │   ├── teams.ts
│       │   └── users.ts
│       ├── auth.ts             # requireUser, requireJudge, requireAdmin, requirePermission
│       ├── convert.ts          # DB row to public API object transformers
│       ├── rateLimit.ts        # In-memory rate limiter (4 tiers: general/auth/vote/upload)
│       ├── basis-auth.ts       # OIDC discovery, PKCE login, callback and UserInfo
│       ├── oauth2.ts           # Public-origin helper
│       ├── oauth2-jwt.ts       # basis-auth resource-token validation
│       ├── profile.ts          # Profile picture helpers
│       ├── assets.ts           # Asset helpers
│       ├── url-validation.ts   # SSRF protection — validates external URLs, blocks private IPs
│       └── deepseek-store.ts   # DeepSeek AI chat session store (in-memory)
│
├── shared/                     # Code shared between client and server
│   ├── schemas.ts              # Zod schemas for API input validation
│   ├── database.d.ts           # TypeScript types matching DB schema exactly
│   ├── responses.d.ts          # API response interface definitions
│   ├── permissions.ts          # basis-auth delegated permission helpers
│   ├── oauth2-scopes.ts        # OAuth2 scope definitions, descriptions, and helpers
│   ├── permissions.ts          # Nethack JWT permission constants and matcher
│   ├── rubric.ts               # Judging rubric definitions (junior/senior criteria and weights)
│   └── seasons.ts              # Season metadata (theme, date, docs links)
│
├── sql/archive/                # Archived legacy SQL schema and migrations
│   ├── init.sql                # Historical base schema
│   ├── migration-*.sql         # Historical dated migrations
│   └── patch-*.sql             # Historical feature patches
│
├── drizzle/                    # Drizzle Kit generated migration files
│   ├── *.sql                   # Migration SQL
│   └── meta/                   # Drizzle Kit metadata snapshots
│
├── tests/                      # Vitest test suite
│   ├── setup.ts                # Global test setup, in-memory DB, mocks
│   ├── **/*.test.ts            # API, server utility, shared, component, page, etc.
│   ├── index.js                # Legacy test runner (kept for reference)
│   ├── test.deepseek.ts        # Legacy DeepSeek API tests (reference)
│   └── test.microsoft.ts       # Legacy MS Graph API tests (reference)
│
├── bun-shim/                   # Compatibility shim for `bun test`
│   └── shim.test.ts            # Prints guidance to use `bun run test`
│
├── database/                   # Drizzle schema and PostgreSQL migrations
├── documentation/              # VitePress documentation site
├── public/                     # Committed static assets (fonts, images, showcase)
├── assets/                     # Gitignored runtime uploads; preserve, restore, and back up separately
└── scripts/                    # Build scripts
```

## Key Concepts

### Single-Row Hackathon State

The `hackathon` table contains a single row (`id = 1`) that controls the global event state. The status field determines what actions are available:

| Status        | Description                                           |
| ------------- | ----------------------------------------------------- |
| `not_started` | Before the event: teams can form and submit projects. |
| `in_progress` | During the event: project submissions are accepted.   |
| `voting`      | After the event: peer voting is open.                 |
| `finished`    | Event completed: results are published.               |
| `paused`      | Event paused for maintenance.                         |

### Pathways

Teams are categorized into two pathways with different judging rubrics:

- **Junior**: weighted toward Innovation & Originality (30%).
- **Senior**: weighted toward Impact & Usefulness (30%).

### Rubric System

The new-installation default has five criteria on a 0–5 integer scale. Organizers can create season-specific tracks, criteria, integer ranges, and weights; see the [rubric guide](/shared/rubric).

| Criterion                | Junior Weight | Senior Weight |
| ------------------------ | :-----------: | :-----------: |
| Innovation & Originality |      30%      |      10%      |
| Presentation & Design    |      25%      |      25%      |
| Technical Complexity     |      20%      |      20%      |
| Theme Alignment          |      15%      |      15%      |
| Impact & Usefulness      |      10%      |      30%      |

### Peer Voting

During the voting phase, participants distribute 10 stars across eligible projects in the same pathway. The total stars assigned must sum to exactly 10, enforced by the `SubmitVoteRequest` Zod schema.

## Build & Development Commands

```bash
# Install dependencies
bun i

# Dev server (HTTPS, port 24598)
bun dev --https

# Production build
bun run build

# Preview built app
bun run preview

# Run tests
bun run test

# Format code
bun run format
```

## Code Style

The project follows these conventions:

- **Oxfmt**: semicolons enabled, double quotes, `tabWidth: 4`, `trailingComma: all`, `printWidth: 100`.
- **ESLint**: configured via `@nuxt/eslint`.
- **Imports**: use `~~/` for project root imports in server code, `~/` for app imports.
- **Components**: prefer `const` and arrow functions.
- **Vue**: Composition API with `<script setup lang="ts">`.

## Next Steps

- [Environment Setup](/guide/environment-setup): configure your development environment.
- [Architecture Overview](/architecture/overview): understand how the app works internally.
- [Authentication & Authorization](/architecture/auth): deep dive into the auth system.
- [OAuth2 System](/architecture/oauth2): learn about the OAuth2 authorization server.
