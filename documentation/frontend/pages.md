---
title: Pages
description: File-based routes in the nethack frontend — home, dashboard, voting, judging, mod portal, and OAuth2 flows.
---

# Pages

The nethack frontend contains **28 page files** in `app/pages/`, mapped to routes via Nuxt's file-based routing. All pages use `<script setup lang="ts">`.

## Public Pages

### `/` (index)

**File:** `app/pages/index.vue`

The home page. Fetches the active hackathon season from `/api/seasons/active` and renders:

- **Welcome message** with the `WEBSITE_NAME` constant
- **Announcement** — admin-editable copy from `announcement` is shown above the schedule when set; the page contains no hardcoded season or event text
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

Season showcase index. The featured section links to the Beneath the Surface experience, the curated archive card links to Signal, and the season-driven project archive lists previous seasons that have started.

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

### `/showcase/seasons/:id`

**File:** `app/pages/showcase/seasons/[id].vue`

Historical project archive for an inactive season that has started. The page loads the selected season, then `SeasonProjectArchive` fetches submitted projects from `/api/teams?season_id=:id` and displays their names, descriptions, safe demo and repository links, awards, and ranks when results are published. Blank upcoming seasons are not listed or addressable through this archive.

**Layout:** `fullwidth-nostick`

**Components used:** `ShowcaseBeneathTheSurface`, `GoBackUp`

### `/voting`

**File:** `app/pages/voting.vue`

Peer voting page. Protected by `auth` middleware. Only accessible during the `voting` hackathon status.

**Flow:**

1. Fetches ballot data from `/api/ballot`. When voting is closed, the server's `403` is shown as a closed notice with retry and home actions; the voting form is not rendered.
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

Judge landing page. Protected by `auth` middleware and the judge assignment permission, so past evaluations stay reachable after the event closes.

**Guards:**

- Redirects to `/` if the user lacks judge or admin permissions
- Judging actions are gated by the event status; the page itself stays available for history

**Content:**

- **Current evaluations** — shows judge-specific progress for submitted projects in the active season, with an accessible progress bar
- **Continue judging** — opens the active queue when the event is in `voting` status with `judging_open` enabled
- **Review your evaluations** — links to the active season's history when judging is closed
- **Past evaluations** — shows the judge's completed progress for prior seasons; each card links to that season's read-only history

The page omits unrelated event participation figures so judges can focus on their own workload.

**Layout:** `default`

### `/judging/history/:seasonId`

**File:** `app/pages/judging/history/[seasonId].vue`

Read-only review of the signed-in judge's finalized evaluations for one season. Protected by `auth` middleware and the judge assignment permission; it does not require judging to be open, so completed work remains reviewable after the event finishes.

**Content:**

- Left list of every evaluated project, selectable with Previous and Next controls
- Project name, team, track, repository and demo links, description, and AI-use disclosure, each labeled; missing values are stated explicitly instead of being omitted
- The judge's weighted score, rubric name and version, per-criterion scores, and anonymous feedback
- Evaluations whose immutable rubric is missing or invalid remain in the list with their project details and written feedback; the page shows an explicit "Saved rubric unavailable" alert instead of hiding the comment

The API always returns a row for every finalized evaluation, including legacy rows whose rubric can no longer be reconstructed, so past comments and disclosures are never silently dropped.

**Layout:** `fullwidth` with the footer hidden

### `/judging/continue`

**File:** `app/pages/judging/continue.vue`

Active judging interface. Protected by `auth` middleware. Accessible only by judges or admins while the event is in `voting` status and `judging_open` is enabled. Draft saves and final score submissions enforce the same gate on the server.

**Flow:**

1. Loads the judge's pending projects from `/api/teams?judging=true` (excluding the judge's own team), their personal progress from `/api/ballot/summary`, and the active rubric from `/api/judging/rubric`.
2. Shows one project at a time. The project pane lists every competitor-submitted field: team, pathway, project name, project description, AI-use disclosure, repository, demo, and submission status. Descriptions and disclosures render through `SafeComark`, so Markdown is parsed with raw HTML disabled and single newlines preserved. Missing values are named explicitly (for example, "Alixa did not provide a project description") rather than leaving blank space. The right pane shows Scoring Guidelines, the rubric, and the feedback form. The divider between the panes is draggable with a pointer or the arrow keys and remembers its position; both panes scroll independently on wider screens and stack on mobile.
3. The toolbar shows the project number, evaluated count, Previous and Next, **Next unscored**, and **All projects**. All projects opens a navigator listing every page of the queue with each project's scored state, plus filters for all, not scored, and scored projects. After a successful final submission the page re-reads the current queue page and the progress summary from the server, so an evaluated project can never be reported as unscored and **Next unscored** always scans committed state.
4. Saves scores and feedback to `/api/judging/drafts/{teamId}` after a short pause while the judge works. Each draft stays pinned to the rubric version shown when scoring began, even if an organizer publishes a newer version mid-session. The form gives guidance to keep comments specific, respectful, project-focused, and anonymous; editable prompt starters can be inserted into the comment. Teams see anonymous comments only after results are published and at least three judges have evaluated their team; authorized administrators can see judge identities in the admin feedback view.
5. The page offers a retry action when draft loading or saving fails. Retrying a dirty draft saves it against its pinned version without reloading or reinterpreting its scores. If the server will never accept the draft (for example, judging closed or the rubric was replaced), **Discard and reload** replaces the unsaved text with the last saved draft so the judge is not trapped, and the page blocks leaving only when unsaved changes cannot be saved.
6. Opens the **Review before you finalize** dialog over the scoring workspace before the final `POST /api/teams/{teamId}/scores` submission. A successful evaluation becomes read-only and the queue advances to the next pending project.

When every submitted project has been evaluated, the workspace stays open so judges can review their saved scores instead of being locked out. The interface is mobile-first, uses keyboard-operable score controls, and shows draft saving, validation, and submission states. Evaluation progress is shown on the judging overview.

**Layout:** `fullwidth` with the footer hidden

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

Mod portal landing page. Summarizes the live event — active season, status, theme, schedule, and the visitor-facing toggles — and links to each management area. Wrapped in `UDashboardPanel` with `UDashboardNavbar` and `UDashboardSidebarCollapse` so mobile users can open the sidebar navigation.

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

### `/developers/docs`

**File:** `app/pages/developers/docs.vue`

Admin-only documentation viewer. Embeds the protected VitePress site at `/docs/` in a full-height same-origin iframe, so organizers keep the portal sidebar while reading the reference. The navbar action opens the standalone `/docs/` site in a new tab. The docs theme's **Portal** link uses `target="_top"` to return the outer portal window from inside the frame.

**Layout:** `developers-dashboard`

### `/developers/debug`

**File:** `app/pages/developers/debug.vue`

Permission-gated, read-only listings of existing files and active permalink references.

**Layout:** `developers-dashboard`

### `/developers/season`

**File:** `app/pages/developers/season.vue`

Hackathon Administration page (admin-only, hard 403 for non-admins). The page is split into tabs so no single scroll holds every control. It opens on the active season and warns when a stored (non-live) season is selected, so settings never appear to apply while silently targeting an archived season.

- **Overview** — theme, schedule, and the current visitor-facing toggles for the selected season, with shortcuts to the editing tabs. The schedule uses the same stored values as the editable fields.
- **Seasons** — pick the season to manage, rename it, activate it (`PATCH /api/seasons/active`), create one via `POST /api/admin/seasons`, or delete an unused inactive season via `DELETE /api/admin/seasons/:id`. A new season starts as a copy of the live settings so switching cannot blank the event. A banner shows whether the selected season is live or stored, with a one-click activation action.
- **Event settings** — status, vote cap, voting/judging/results toggles, theme, visitor announcement, and schedule timestamps, auto-saved one field at a time through `/api/admin/hackathon`. Status, voting, judging, results, show-score/show-ranking, and the announcement are PostgreSQL overrides, so they can be switched even when the manifest is remote. Each field is compared with the selected season's own value, not another season's. Schedule and theme write to a local `HACKATHON.yml` (comments preserved); a remote manifest keeps those fields read-only and explains where to edit them. Other seasons keep their own editable stored settings.
- **Scoring** — score display curve and the judging rubric. The rubric editor publishes the live rubric by editing `HACKATHON.yml` when its `rubric` section is configured; for database-managed seasons it edits track keys and labels, criteria, integer score ranges, and weights. Weights must total 100% for each track. Saving creates a new immutable version; the history shows which version is active. Organizers can copy a prior season, load its rubric to customize, and apply or copy reusable named templates. A track used by a submitted project must be reassigned before removal.
- **Data** — download an anonymized JSON snapshot or CSV via `GET /api/admin/database/export`; judge IDs and draft evaluations are omitted, and the exported live settings include portal overrides.

**Layout:** `developers-dashboard`

## Login Flow

`/api/login` redirects directly to basis-auth, so nethack no longer renders a native authorization or consent page. basis-auth owns provider login and consent UI; nethack handles only its callback and local session.

## User Profile

### `/user/[id]`

**File:** `app/pages/user/[id].vue`

Public user profile page.

**Features:**

- Fetches user data from `/api/users/{id}`
- If the user has a `profile_theme` with mode `url`, sets the background image from `/userast/{value}`
- Renders the member card with avatar and an `h1` name on top of the themed background, so the page never looks blank
- Public responses omit the email address, so only the display name is shown

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
