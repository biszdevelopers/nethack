---
title: Pages
description: File-based routes in the basishacks frontend — home, dashboard, voting, judging, mod portal, and OAuth2 flows.
---

# Pages

The basishacks frontend contains **28 page files** in `app/pages/`, mapped to routes via Nuxt's file-based routing. All pages use `<script setup lang="ts">`.

## Public Pages

### `/` (index)

**File:** `app/pages/index.vue`

The home page. Fetches the active hackathon season from `/api/seasons/active` and renders:

- **Welcome message** with the `WEBSITE_NAME` constant
- **Status alert** — links to `/dashboard` when the hackathon has started or finished
- **Schedule section** — conditionally renders `LargeCountdown` components based on hackathon status:

| Status        | Countdowns shown                 |
| ------------- | -------------------------------- |
| `not_started` | Hackathon starts, Hackathon ends |
| `in_progress` | Hackathon ends, Voting starts    |
| `voting`      | Voting ends, Results released    |
| `paused`      | Maintenance message              |
| `finished`    | No countdowns                    |

- **Detailed schedule** — collapsible section with `DateTime` components for all timestamps
- **Theme section** — reveals theme name and description once set, otherwise shows a countdown to the start date
- **Resources section** — links to last year's showcase and the rules page

**Layout:** `default`

```vue
// No auth required
```

### `/seasons/:id`

**File:** `app/pages/seasons/[id].vue`

Public season details page linked from team score cards. It shows the selected season's event dates, theme when it is available, current-season status, and navigation to other seasons. Invalid or unknown season IDs return a not-found page.

**Layout:** `default`

### `/profile`

**File:** `app/pages/profile.vue`

User profile editing page. Protected by `auth` middleware.

The page loads the signed-in user's API record through `useApiUser()`. This waits for the client-side session request and watches the session user ID so profile data loads after the cookie session becomes available during hydration.

**Features:**

- Displays greeting with user name or email
- **Name editing** — text input validated by `UpdateUserRequest`
- **Avatar** — displays the basis-auth picture through `UserAvatar`. The image URL is synchronized at login.
- **Profile theme image** — `UFileUpload` for background image. Displays the current theme as a CSS background. Affects the user's profile page (`/user/{id}`) and `UserPopover` card.
- **Logout button** — clears the session and navigates to `/`

**API:** `PATCH /api/users/{id}` with body containing `name`, `avatar` (base64 or null), `profile_theme_image` (base64 or null).

**Layout:** `default`

### `/rules`

**File:** `app/pages/rules.vue`

Static rules page listing hackathon requirements:

- Open-source repository (GitHub or Gitee)
- README file
- Public demo URL (with specific rules for websites, desktop apps, games, and mobile apps)
- Demo video (1–3 minutes)
- Theme adherence

**Layout:** `default`

### `/showcase`

**File:** `app/pages/showcase/index.vue`

Season showcase index. The featured top section links to the current Beneath the Surface experience, and the archive section beneath it links to the previous Signal experience.

**Layout:** `fullwidth-nostick`

### `/showcase/signal`

**File:** `app/pages/showcase/signal.vue`

Animated Signal showcase for the previous season's top projects. A highly visual, scroll-driven experience.

**Layout:** `fullwidth-nostick`

**Sections:**

| Section | Description |
| --- | --- |
| Title | Full-screen landscape background with "When there is Signal" title, neon flicker animation |
| Team #1 | Scroll-driven video playback, cursor-following gold aura effect, slide-right description transition |
| Team #2 | Word-by-word shake animation for project name, metallic silver styling, dual image layout |
| Team #3 | Slide-left transition, metallic bronze styling, window mockup with screenshot |
| All Projects | Dual `UMarquee` carousels of `ShowcaseMarqueeCard` components, clickable to open a project modal |

**Scroll-driven animations:**

- Team #1 video: `currentTime` is set proportional to scroll position within the section
- Team #2 and #3: visibility triggers when elements enter the viewport
- "Scroll for more" indicator fades out after scrolling past 25% viewport height

**Preloading:** Images and videos are preloaded via `<link rel="preload">` in `useHead`.

**Components used:** `GoBackUp`, `LoaderAnimation`, `ResultsProjectLinks`, `ShowcaseMarqueeCard`, `ProjectCard`

::: tip This page uses custom CSS animations including `metallic-gold`, `metallic-silver`, `metallic-bronze`, `neon` flicker, and `appearAndShake` word animations. :::

### `/showcase/beneath-the-surface`

**File:** `app/pages/showcase/beneath-the-surface.vue`

Season 1's data-driven winners showcase for **Beneath the Surface**. Its `ShowcaseBeneathTheSurface` component fetches `/api/teams?season_id=1` and merges the public records with a frozen historical winner configuration.

**Layout:** `fullwidth-nostick`

| Pathway | Rank | Project                    |
| ------- | ---- | -------------------------- |
| Junior  | 1    | Where the Rainbow Ends     |
| Junior  | 2    | Beneath the Land           |
| Junior  | 3    | Horror Forest              |
| Senior  | 1    | metadata manipulation tool |
| Senior  | 2    | Unseen Layers              |
| Senior  | 3    | TraceShadow                |

Each winner receives a full-viewport, project-specific visual chapter. Project names, team names, and links come from the Season 1 API; the frozen title and summary remain visible if a record cannot be loaded. "Open project" launches a `UModal` with the shared `ProjectCard` using the already loaded public team record, while the repository button links out directly. The hero and closing headings use Unbounded, and each chapter heading uses its own locally hosted display font (Orbitron, Silkscreen, Creepster, Space Mono, Cormorant Garamond, Chakra Petch). Ranks appear as shimmering metallic `#1`/`#2`/`#3` medals (gold/silver/bronze, like the previous season), and pathways as sonar chips labeled junior or senior.

**Motion:** GSAP and ScrollTrigger create the hero entrance, depth progress, desktop pinned sections, scroll-linked reveals, ambient layers, and pointer parallax. Mobile layouts use natural scrolling. `prefers-reduced-motion` disables pinning, scrubbing, parallax, and ambient movement while keeping all content visible.

**Components used:** `ShowcaseBeneathTheSurface`, `GoBackUp`

### `/voting`

**File:** `app/pages/voting.vue`

Peer voting page. Protected by `auth` middleware. Only accessible during the `voting` hackathon status.

**Flow:**

1. Fetches ballot data from `/api/ballot`
2. Displays eligible `VotingProjectCard` components in a grid
3. User distributes **10 stars** among eligible projects (0–5 per project)
4. Increment/decrement buttons with validation (total must equal 10)
5. Reasoning textarea
6. Submit with browser `confirm()` dialog

**Validation:** Uses `SubmitVoteRequest` schema. Posts to `/api/ballot`.

**Layout:** `default`

### `/contributing`

**File:** `app/pages/contributing.vue`

Contributing guidelines and security disclosure policy. Contains commit guidelines, instructions for privately reporting security issues (with guidance on self-fixing via obfuscated pull requests), a responsible disclosure policy, and a code of conduct. Written in professional academic American English. Linked from the site footer.

**Layout:** `default`

## Judging Pages

### `/judging`

**File:** `app/pages/judging/index.vue`

Judge landing page. Protected by `auth` middleware. Accessible only by judges or admins while the event is in `voting` status and `judging_open` is enabled.

**Guards:**

- Redirects to `/` if hackathon status is not `voting` or `judging_open` is disabled
- Redirects to `/` if user lacks judge or admin permissions

**Content:**

- **Current evaluations** — shows judge-specific progress for submitted projects in the active season, with an accessible progress bar
- **Continue judging** — opens the active queue when projects remain
- **Past evaluations** — shows the judge's completed progress for prior seasons

The page omits unrelated event participation figures so judges can focus on their own workload.

**Layout:** `default`

### `/judging/continue`

**File:** `app/pages/judging/continue.vue`

Active judging interface. Protected by `auth` middleware. Accessible only by judges or admins while the event is in `voting` status and `judging_open` is enabled. Draft saves and final score submissions enforce the same gate on the server.

**Flow:**

1. Loads the judge's pending projects from `/api/teams?judging=true`, their personal progress from `/api/ballot/summary`, and the active rubric from `/api/judging/rubric`.
2. Shows one project at a time with repository/demo links, project details, AI-use statement, and the criteria for that project's track.
3. Saves scores and feedback to `/api/judging/drafts/{teamId}` after a short pause while the judge works. Each draft stays pinned to the rubric version shown when scoring began, even if an organizer publishes a newer version mid-session. The form gives guidance to keep comments specific, respectful, project-focused, and anonymous; editable prompt starters can be inserted into the comment. Teams see anonymous comments only after results are published and at least three judges have evaluated their team; authorized administrators can see judge identities in the admin feedback view.
4. The page offers a retry action when draft loading or saving fails. Retrying a dirty draft saves it against its pinned version without reloading or reinterpreting its scores, and the page blocks leaving when unsaved changes cannot be saved.
5. Requires a review step before the final `POST /api/teams/{teamId}/scores` submission. A successful evaluation becomes read-only and the queue advances to the next pending project.

Previous/next controls let a judge move through the current queue while retaining recoverable drafts. The interface is mobile-first, uses keyboard-operable score controls, and provides explicit progress, saving, validation, and submission states.

**Layout:** `default`

## Dashboard Pages

### `/dashboard`

**File:** `app/pages/dashboard/index.vue`

Main dashboard overview. Protected by `auth` middleware. Uses `dashboard` layout.

**Features:**

- Welcome message with status-dependent text (not started, in progress, voting, finished, paused)
- If no team: prompt to create or join a team
- If has team: `ProjectCard` showing the current project
- Action cards linking to General, Teams, and Results pages
- **Confetti animation** — helper functions exist for ranks 1–10 but are not automatically triggered on mount

**Unsaved changes protection:** Listens for `onBeforeRouteLeave` and `beforeunload` events.

**Layout:** `dashboard`

### `/dashboard/general`

**File:** `app/pages/dashboard/general.vue`

Project editing page. Protected by `auth` middleware.

**States:**

- No team and hackathon not started → "Hackathon not started yet!" CTA
- No team and hackathon started → "You don't have a team yet!" CTA
- Has team → `ProjectForm` (disabled when submission is closed or already submitted)
- Project already submitted → congratulations message with disabled form

**XSS-safe content:** All user-provided project content (descriptions, sourcing notes) is rendered using `SafeComark` throughout the page, which sanitizes inline Markdown and replaces `<a>` tags with `SafeLink` to prevent unsafe URLs.

**Unsaved changes protection:** Same pattern as dashboard index — `onBeforeRouteLeave` + `beforeunload`.

**Layout:** `dashboard`

### `/dashboard/teams`

**File:** `app/pages/dashboard/teams/index.vue`

Team creation and management. Protected by `auth` middleware.

**States:**

- No team → `CreateTeamRequest` form (team name only)
- Has team → `TeamForm` component

**Layout:** `dashboard`

### `/dashboard/results`

**File:** `app/pages/dashboard/results.vue`

Season results page. Protected by `auth` middleware.

**Content:**

- Current season results via `ScoreCard`
- Past season results via `ScoreCard` for each `past_teams` entry

**Layout:** `dashboard`

### `/dashboard/presentation`

**File:** `app/pages/dashboard/presentation.vue`

Placeholder page for the presentation event. States that top 10 teams will be invited to present.

**Layout:** `dashboard`

## Mod Portal

**Access:** Home, users, teams, DeepSeek, files, and season management require admin permission. The applications portal remains granular: application view, view-all, and create permissions grant access to their corresponding application routes; all other developer routes return a hard 403 for non-admin users.

### `/developers`

**File:** `app/pages/developers/index.vue`

Mod portal landing page. Shows a welcome message. Wrapped in `UDashboardPanel` with `UDashboardNavbar` and `UDashboardSidebarCollapse` so mobile users can open the sidebar navigation.

**Layout:** `developers-dashboard`

### `/developers/users`

**File:** `app/pages/developers/users.vue`

User management page.

**Layout:** `developers-dashboard`

### `/developers/teams`

**File:** `app/pages/developers/teams.vue`

Team management page.

The table includes a **Members** column that renders a `UserAvatarGroup` (with `developer-mode` enabled, so hovering shows each member's id beside their name) fed by the `members` array returned from `GET /api/admin/teams`.

**Layout:** `developers-dashboard`

### `/developers/deepseek`

**File:** `app/pages/developers/deepseek.vue`

DeepSeek AI chat interface.

**Layout:** `developers-dashboard`

### `/developers/debug`

**File:** `app/pages/developers/debug.vue`

Permission-gated, read-only listings of existing files and active permalink references.

**Layout:** `developers-dashboard`

### `/developers/season`

**File:** `app/pages/developers/season.vue`

Hackathon Administration page (admin-only, hard 403 for non-admins). Contains:

- **Season** — pick the season to manage and activate it (`PATCH /api/seasons/active`); "New Season" creates one via `POST /api/admin/seasons`.
- **Season Name** — rename the selected season via `PATCH /api/admin/seasons`.
- **Judging rubric** — edit track keys and labels, criteria, integer score ranges, and weights. Weights are checked to total 100% for each track. Saving creates a new immutable version; the version history shows which rubric is active. Organizers can copy a prior season directly or load its rubric to customize, apply or copy reusable named templates, and save, update, or delete templates. A track used by a submitted project must be reassigned before it can be removed.
- **Score display curve** — choose a season-level presentation curve while preserving original judge averages and rankings.
- **Hackathon Configuration** — all settings are per-season (including score and rank visibility) and auto-save through `/api/admin/hackathon` with `season_id`. Editing the active season also syncs to the global `hackathon` row. No "Save" button; every field change is persisted via a serialized PATCH chain carrying all form fields, so no field is ever dropped and no two PATCHes race.
- **Database Export** — download an anonymized JSON snapshot or CSV via `GET /api/admin/database/export`; judge IDs and draft evaluations are omitted.

**Layout:** `developers-dashboard`

## Login Flow

`/api/login` redirects directly to basis-auth, so basishacks no longer renders a native authorization or consent page. basis-auth owns provider login and consent UI; basishacks handles only its callback and local session.

## User Profile

### `/user/[id]`

**File:** `app/pages/user/[id].vue`

Public user profile page.

**Features:**

- Fetches user data from `/api/users/{id}`
- If the user has a `profile_theme` with mode `url`, sets the background image from `/userast/{value}`
- Full-height container with default background overlay

**Layout:** `fullwidth` (set programmatically via `setPageLayout`)

### `/user`

**File:** `app/pages/user/index.vue`

Redirects an authenticated user to their own profile page (`/user/{id}`). If the user is not logged in, redirects to `/login`.

## Debug

### `/debug`

**File:** `app/pages/debug.vue`

Admin-only debug page with two tabs:

- **Existing Files** — browse existing files and active permalink references
- **DeepSeek Chat** — create chat sessions, send messages, and delete sessions via `/api/debug/deepseek/sessions`

Protected by `auth` middleware and an admin permission check.
