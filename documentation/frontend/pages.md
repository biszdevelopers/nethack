---
title: Pages
description: File-based routes in the nethack frontend — home, dashboard, voting, judging, mod portal, and OAuth2 flows.
---

# Pages

The nethack frontend contains **37 page files** in `app/pages/`, mapped to routes via Nuxt's file-based routing. All pages use `<script setup lang="ts">`.

## Public Pages

### `/` (index)

**File:** `app/pages/index.vue`

The home page. Fetches the active hackathon season from `/api/seasons/active` and renders, in order:

- **Event status** — the page heading. States whether the hackathon is upcoming, live, between submissions and voting, voting, paused, or over, with the relevant end date and a primary action (open the dashboard, vote, view results, or read the rules). This is the only `h1` and it makes the event's current state unambiguous.
- **Schedule** — countdowns follow the event status, and the admin-editable `announcement` appears inside this section. The table below lists the countdowns:

| Status        | Countdowns shown                 |
| ------------- | -------------------------------- |
| `not_started` | Hackathon starts, Hackathon ends |
| `in_progress` | Hackathon ends, Voting starts    |
| `voting`      | Voting ends, Results released    |
| `paused`      | Maintenance message              |
| `finished`    | Schedule section is hidden       |

- **Detailed schedule** — collapsible section with `DateTime` components for all timestamps
- **Theme** — reveals the theme name and description once set, otherwise shows the start date
- **How it works** — six numbered steps from team formation through results
- **FAQ** — four short answers with a link to the full FAQ
- **Support and archives** — FAQ, rules, contact, showcase, and gated catalog/results links

The page does not render a separate marketing hero or a facts grid; the event-status heading is a compact state summary, and the schedule follows immediately. A current-season catalog link appears only after the event enters peer voting.

**Layout:** `default`

```vue
// No auth required
```

### `/projects`

**File:** `app/pages/projects.vue`

Public project gallery. It fetches `/api/seasons/active` and requests `/api/teams` only when `is_gallery_public` is true. The server exposes that flag only after the event enters peer voting, so an in-progress season whose deadline has passed still keeps its catalog hidden. Before that point the server returns only the caller's own team, so non-members see an empty gallery rather than a hidden-project leak. The page supports search, pathway filters, and a selected-project query parameter.

**Layout:** `default`

### `/results`

**File:** `app/pages/results.vue`

Public results page. Until `results_published` is true it renders a locked state with the scheduled release time when configured. After publication it loads the submitted-team list and `/api/ballot/results` on the client. It shows final standings and ranks, team awards, the People's Choice winner, and project cards; a project card links to `/certificate/:id` when the team has a rank or award. `/dashboard/results` uses the same publication gate for participants. The active rubric is displayed on `/seasons/:id` and consumed by the project form through `/api/seasons/active/rubric`.

**Layout:** `default`

### `/faq` and `/contact`

Static informational pages. Both are included in the sitemap.

**Layout:** `default`

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

**API:** `PATCH /api/users/{id}` with body containing `name` and `profile_theme_image` (base64 data URL, `File`, or null). The avatar is synchronized from basis-auth at login.

**Layout:** `default`

### `/notifications`

**File:** `app/pages/notifications.vue`

Protected notification list. It reads `/api/notifications` on the client, shows unread counts, marks one notification read (or all of them read), and renders a link only when it is a safe relative path.

**Layout:** `dashboard`

### `/certificate/:id`

**File:** `app/pages/certificate/[id].vue`

Printable team certificate. The page loads the team and its season; the certificate is available only when that season has published results. The page is `noindex` and uses the browser print dialog.

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

Peer voting page. Protected by `auth` middleware. Reads `/api/seasons/active` first and shows the form only while `is_voting_open` is true; the server enforces the `voting_enabled` toggle, the pause switch, and the configured voting start and end timestamps.

**Flow:**

1. When voting is closed, renders a neutral notice that explains the current phase (not started, closed, paused, or ended) and links to results when they are published. It does not request a ballot, so a closed page produces no error toast or console failure.
2. Otherwise fetches ballot data from `/api/ballot` and displays eligible `VotingProjectCard` components in a grid
3. User distributes **10 stars** among eligible projects (0–5 per project), optionally capped to a maximum number of scored projects by `max_votes_per_user`
4. Increment/decrement buttons with validation (total must equal 10)
5. Reasoning textarea
6. Submit with browser `confirm()` dialog; a submitted ballot remains editable until voting closes

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
- **Continue judging** — opens the active queue when the server-reported `is_judging_open` flag is true (the `judging_open` portal toggle is on and the event is not paused)
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

Active judging interface. Protected by `auth` middleware. Accessible only by judges or admins while the server-reported `is_judging_open` flag is true (the `judging_open` portal toggle is on and the event is not paused). The toggle is authoritative and is not vetoed by the event phase or published results. The page consumes that flag from `GET /api/seasons/active` rather than recomputing the gate, so it cannot disagree with the queue, draft, and submission endpoints that enforce the same check.

**Flow:**

1. Loads the judge's pending projects from `/api/teams?judging=true` (excluding the judge's own team), their personal progress from `/api/ballot/summary`, and the active rubric from `/api/judging/rubric`.
2. Shows one project at a time. The project pane lists every competitor-submitted field: team, pathway, project name, project description, AI-use disclosure, repository, demo, and submission status. Descriptions and disclosures render through `SafeComark`, so Markdown is parsed with raw HTML disabled and single newlines preserved. Missing values are named explicitly (for example, "Alixa did not provide a project description") rather than leaving blank space. The right pane shows Scoring Guidelines, the rubric, and the feedback form. The divider between the panes is draggable with a pointer or the arrow keys and remembers its position; both panes scroll independently on wider screens and stack on mobile.
3. The toolbar shows the project number, evaluated count, Previous and Next, **Next unscored**, and **All projects**. All projects opens a navigator listing every page of the queue with each project's scored state, plus filters for all, not scored, and scored projects. After a successful final submission the page re-reads the current queue page and the progress summary from the server, so an evaluated project can never be reported as unscored and **Next unscored** always scans committed state.
4. Saves scores and feedback to `/api/judging/drafts/{teamId}` after a short pause while the judge works. Each draft stays pinned to the rubric version shown when scoring began, even if an organizer publishes a newer version mid-session. The form gives guidance to keep comments specific, respectful, project-focused, and anonymous; editable prompt starters can be inserted into the comment. Teams see anonymous comments only after results are published and at least three judges have evaluated their team; authorized administrators can see judge identities in the admin feedback view.
5. The page offers a retry action when draft loading or saving fails. Retrying a dirty draft saves it against its pinned version without reloading or reinterpreting its scores. If the server will never accept the draft (for example, judging closed or the rubric was replaced), **Discard and reload** replaces the unsaved text with the last saved draft so the judge is not trapped, and the page blocks leaving only when unsaved changes cannot be saved. A judge can record a recusal for the current project, which removes it from their queue, or flag it for the organizers; both actions appear in the administrator's judge coverage page.
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

- Current-season team via `ScoreCard`, which applies that season's publication, score, and rank visibility gates
- Past-season teams via `ScoreCard` for each `past_teams` entry
- Certificate links; the certificate page itself returns an unavailable state until the team's season publishes results

**Layout:** `dashboard`

### `/dashboard/presentation`

**File:** `app/pages/dashboard/presentation.vue`

Placeholder page for the presentation event. States that top 10 teams will be invited to present.

**Layout:** `dashboard`

## Mod Portal

**Access:** Home, users, teams, DeepSeek, files, awards, audit, judging coverage, and season management require administrator permission. The retired applications portal no longer exists. Non-admin users receive a hard 403.

### `/developers`

**File:** `app/pages/developers/index.vue`

Mod portal landing page. Summarizes the live event — active season, status, theme, schedule, and the visitor-facing toggles — and links to each management area. The badges show effective visibility: voting and judging are off while the event is paused, and scores and rankings are shown as visible only when results are published and the matching switch is on. It also runs event preflight (`GET /api/admin/preflight`), offers a one-click results publication that freezes judging and voting, and downloads the standings CSV (`GET /api/admin/standings.csv`). Wrapped in `UDashboardPanel` with `UDashboardNavbar` and `UDashboardSidebarCollapse` so mobile users can open the sidebar navigation.

**Layout:** `developers-dashboard`

### `/developers/users`

**File:** `app/pages/developers/users.vue`

User management page. Administrators can promote or demote administrators and judges. A promoted judge receives judging permissions on the next session refresh; administrators are judges automatically. Participants are not judges unless promoted or assigned.

**Layout:** `developers-dashboard`

### `/developers/teams`

**File:** `app/pages/developers/teams.vue`

Team management page.

The table includes a **Members** column that renders a `UserAvatarGroup` (with `developer-mode` enabled, so hovering shows each member's id beside their name) fed by the `members` array returned from `GET /api/admin/teams`. Team rows expose the status control (`active`, `withdrawn`, `disqualified`, `no_show`), submission reopen, award assignment, and per-judge evaluation void actions; each mutation writes an audit row and refreshes the standings.

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

### `/developers/awards`

**File:** `app/pages/developers/awards.vue`

Award manager for the shared award catalog and per-team assignments. Definitions use a stable namespace, display name, description, icon, and color. Award mutation endpoints write audit rows.

**Layout:** `developers-dashboard`

### `/developers/audit`

**File:** `app/pages/developers/audit.vue`

Read-only administrative audit log. Supports a season filter and a bounded limit; each row shows the actor, action, entity, before/after values, reason, request ID, and time.

**Layout:** `developers-dashboard`

### `/developers/judging`

**File:** `app/pages/developers/judging.vue`

Judge coverage and flag queue. Administrators create assignments for a pathway or a team, remove assignments, see per-judge coverage, and resolve open conflict flags with the reporting judge's identity.

**Layout:** `developers-dashboard`

### `/developers/season`

**File:** `app/pages/developers/season.vue`

Seasons page (admin-only, hard 403 for non-admins). The page separates running the event, editing one season's settings, managing the season list, managing the rubric, and site-wide data. It opens on the active season and marks other seasons as stored so settings never appear to apply while silently targeting an archived season.

- **Run season** — the selected season's stage, a single next action (open submissions, open peer voting and judging, publish results, finish), readiness checks, pause/resume, reset-stage actions (reopen submissions, reopen voting and judging, unpublish results, reset to setup), and live counts from `/api/admin/preflight`. Reset actions keep teams, projects, and scores; unpublishing clears the stored snapshot and timestamp so a later publication creates a fresh one
- **Season settings** — one explicit-save form for schedule, theme, announcement, vote cap, and results visibility, all stored against the selected season and applied immediately when it is live
- **Seasons** — the season list, creation with optional settings copy, activation prerequisites, rename, delete, team limit, and blank-start board approval. Activation uses `PATCH /api/seasons/active`; a new season uses `POST /api/admin/seasons`; an inactive season uses `DELETE /api/admin/seasons/:id`, and seasons holding team, judging, or peer-voting history are rejected so archived results are never silently erased
- **Rubric** — score display curve and the judging rubric. The rubric editor publishes the live rubric by editing `HACKATHON.yml` when its `rubric` section is configured; for database-managed seasons it edits track keys and labels, criteria, integer score ranges, and weights. Weights must total 100% for each track. Saving creates a new immutable version, and the history shows which version is active
- **Site and data** — links to the site-wide award catalog and the anonymized database export. The award catalog is independent of seasons, while award assignments belong to a team. The export streams inside a repeatable-read, read-only transaction and omits judge identities, invitation tokens, and OAuth client secrets

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

Redirects an authenticated user to their own profile page (`/user/{id}`). If the user is not logged in, redirects to `/api/login?redirect=/user`.

## Debug

### `/debug`

**File:** `app/pages/debug.vue`

Admin-only debug page with two tabs:

- **Existing Files** — browse existing files and active permalink references
- **DeepSeek Chat** — create chat sessions, send messages, and delete sessions via `/api/debug/deepseek/sessions`

Protected by `auth` middleware and an admin permission check.
