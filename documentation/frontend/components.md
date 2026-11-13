---
title: Components
description: Vue components used across the basishacks frontend — navigation, forms, scoring, avatars, awards, and visual effects.
---

# Components

The basishacks frontend contains **26 Vue components** organized in `app/components/`. All components use `<script setup lang="ts">` and the `@nuxt/ui` component library.

## Navigation & Layout

### RoleHeader

**File:** `app/components/RoleHeader.vue`

The main navigation header rendered at the top of every page. Uses `UHeader` from `@nuxt/ui`.

**Features:**

- Displays `basishacks_2026` as the site title
- Navigation menu with conditional items based on user role and hackathon status
- Color mode toggle button
- User avatar link to `/profile` (or a generic account icon when logged out)

**Conditional navigation items:**

| Item | Condition |
| --- | --- |
| Home | Always visible |
| Dashboard (with children: Overview, General, Teams, Results) | Always visible |
| Showcase | Always visible |
| Beneath the Surface | Always visible |
| Voting | Hackathon status is `voting` and user is not a judge or admin |
| Judging | User is a judge or admin, hackathon status is `voting`, and `judging_open` is enabled |

Display-only permission checks use `useNethackPermissions()`; server APIs enforce verified JWT permissions.

```vue
<RoleHeader />
```

### Footer

**File:** `app/components/Footer.vue`

Site-wide footer using `UFooter`. Contains three sections:

| Section | Content |
| --- | --- |
| Left | Copyright notice (auto-updates year), link to the contributing page, and link to the mod portal |
| Center | Navigation links to [biszweb.club](https://biszweb.club/club_sites/developers_club) and [binj.dev](https://binj.dev) |
| Right | Microsoft Teams button (inline SVG) and GitHub button linking to the repository |

```vue
<Footer />
```

### TeamsIcon

**File:** `app/components/TeamsIcon.vue`

Inline SVG component for the Microsoft Teams icon used in the footer and user popover. Renders the official Teams logo with gradient fills at a default size of `w-6 h-6`.

```vue
<TeamsIcon />
```

## Project & Team Forms

### ProjectForm

**File:** `app/components/ProjectForm.vue`

Edit and submit project details with auto-save functionality. Used on the dashboard general page.

**Props:**

| Prop       | Type                           | Default | Description                            |
| ---------- | ------------------------------ | ------- | -------------------------------------- |
| `team`     | `APITeam \| null \| undefined` | —       | The team whose project is being edited |
| `disabled` | `boolean`                      | `false` | Disables all form fields               |

**Events:**

| Event     | Payload   | Description                               |
| --------- | --------- | ----------------------------------------- |
| `dirty`   | `boolean` | Emitted when form dirty state changes     |
| `refresh` | —         | Emitted after a successful save or submit |

**Auto-save:** Runs every **10 seconds** via `setInterval`. Only saves when the form is dirty and a team exists. Sends a `PATCH` request to `/api/teams/{id}`.

**Form fields:**

- Project name (`project.name`)
- Project description (`project.description`) — textarea with guidance template
- Demo URL (`project.demo_url`)
- Repository URL (`project.repo_url`)
- Pathway (`pathway`) — radio group: Junior / Senior

**Validation:** Uses `UpdateTeamRequest` for saves and `SubmitTeamRequest` for submissions (both from `~~/shared/schemas`).

**Submit flow:** Clicking "Submit" sets the intent to `submit` and shows a `ModalConfirm` dialog warning that changes cannot be made after submission.

```vue
<ProjectForm :team="team" :disabled="isSubmitted" @dirty="onDirty" @refresh="refreshData" />
```

### TeamForm

**File:** `app/components/TeamForm.vue`

Team management component for renaming, adding, and removing members.

**Props:**

| Prop       | Type      | Description          |
| ---------- | --------- | -------------------- |
| `team`     | `APITeam` | The team to manage   |
| `disabled` | `boolean` | Disables all actions |

**Events:**

| Event     | Payload | Description                                      |
| --------- | ------- | ------------------------------------------------ |
| `refresh` | —       | Emitted after any mutation (rename, add, remove) |

**Features:**

- **Rename team** — Opens a `UModal` with a form validated by `UpdateTeamRequest`
- **Add member** — Opens a `UModal` with an email field validated by `AddTeamMemberRequest`
- **Remove member** — Each member card has a `ModalConfirm` button; self-removal triggers a "leave" message, and removing the last member warns about team deletion
- Rename, add, and remove actions have descriptive accessible names and 44px minimum touch targets.

`RoleHeader` gives the profile action a clear name for signed-in and signed-out visitors. The season editor associates each checkbox with its visible label, and score-card shimmer animations stop when reduced motion is requested.

```vue
<TeamForm :team="team" :disabled="submitted" @refresh="refreshData" />
```

## Scoring & Voting

### JudgingCard

**File:** `app/components/JudgingCard.vue`

Judge scoring card for evaluating a team's project against rubric criteria.

**Scoring interface:**

- Displays the project name, team name, track, safe-rendered description, AI sourcing statement, and validated repository/demo links.
- Renders the active season rubric's configured integer ranges and criterion weights.
- Saves a recoverable draft, gives comment guidance and editable prompt templates, and previews the complete evaluation before finalization.
- Requires a specific anonymous comment; judges are told that comments become visible after results are published.

**Validation:** Validates against the immutable rubric version used for the season. Drafts use `/api/judging/drafts/:teamId`; final scores post to `/api/teams/:id/scores`.

The card reads the assigned project and its judge-specific draft from the judging page. The queue owns project navigation, paging, and final score submission.

### VotingProjectCard

**File:** `app/components/VotingProjectCard.vue`

Interactive card displaying a project for peer voting. Shows project name, team name, pathway badge, description rendered with `Comark`, and repo/demo links, plus star increment and decrement controls.

**Props:**

| Prop           | Type      | Description                           |
| -------------- | --------- | ------------------------------------- |
| `team`         | `APITeam` | The team/project to display           |
| `score`        | `number`  | Current star count for this project   |
| `canIncrement` | `boolean` | Whether the user can add another star |
| `canDecrement` | `boolean` | Whether the user can remove a star    |

**Emits:**

| Event       | Description                       |
| ----------- | --------------------------------- |
| `increment` | User clicked the increment button |
| `decrement` | User clicked the decrement button |

```vue
<VotingProjectCard
    :team="team"
    :score="state.scores[index]"
    :can-increment="state.scores[index] < 5 && totalStars < 10"
    :can-decrement="state.scores[index] > 0"
    @increment="increment(index)"
    @decrement="decrement(index)"
/>
```

## Results & Display

### ScoreCard

**File:** `app/components/ScoreCard.vue`

Primary results card used on the dashboard results page. Displays season results with metallic shimmer effects for top placements.

**Props:**

| Prop   | Type              | Description                       |
| ------ | ----------------- | --------------------------------- |
| `team` | `GetTeamResponse` | The team with score and rank data |

**Visual effects:**

| Rank        | CSS Class         | Effect                            |
| ----------- | ----------------- | --------------------------------- |
| #1          | `metallic-gold`   | Gold gradient shimmer animation   |
| #2          | `metallic-silver` | Silver gradient shimmer animation |
| #3          | `metallic-bronze` | Bronze gradient shimmer animation |
| Score = 800 | `rainbow-once`    | One-time rainbow sweep animation  |

The card displays the season name, original score, ranking, team name, pathway badge, member avatars via `UserAvatarGroup`, awarded badges via `AwardButton`, and a link to that team's season details at `/seasons/:id`. A modal trigger renders the full project inside a `ProjectCard`. When a project has not been submitted, the score and rank are blurred with an overlay message.

```vue
<ScoreCard :team="team" />
```

### JudgeProgressCard

**File:** `app/components/JudgeProgressCard.vue`

Compact card showing judging progress for a single season: how many projects have been scored versus how many were submitted.

**Props:**

| Prop     | Type                | Description                                              |
| -------- | ------------------- | -------------------------------------------------------- |
| `season` | `BallotSummaryItem` | Season summary with `submitted_count` and `scored_count` |

```vue
<JudgeProgressCard :season="season" />
```

### ShowcaseMarqueeCard

**File:** `app/components/ShowcaseMarqueeCard.vue`

Horizontal scroll card used in the showcase marquee. Displays project rank, awarded badges, pathway badge, project name, project description, and member avatars via `UserAvatarGroup` (fetched from `/api/teams/[id]/users`; only visible to logged-in users, "(No members)" otherwise). Applies metallic gradient text for ranks 1–3, and renders "Unranked" otherwise.

**Props:**

| Prop   | Type              | Description         |
| ------ | ----------------- | ------------------- |
| `team` | `GetTeamResponse` | The team to display |

**Emits:**

| Event   | Description                    |
| ------- | ------------------------------ |
| `click` | Fired when the card is clicked |

```vue
<ShowcaseMarqueeCard :team="team" @click="openDetail(team)" />
```

### ProjectCard

**File:** `app/components/ProjectCard.vue`

Fetches and displays a team's project card by ID. Shows project name, team name, description rendered with `SafeComark`, repo/demo links, and awarded badges via `AwardButton`. `SafeComark` extracts the supplied slot text and passes it to Comark as markdown, so descriptions render consistently in every card context.

**Props:**

| Prop | Type     | Description          |
| ---- | -------- | -------------------- |
| `id` | `number` | The team ID to fetch |

```vue
<ProjectCard :id="teamId" />
```

When a parent already has a public `GetTeamResponse`, it can pass `:team="team"` instead. This avoids a second request to the authenticated single-team endpoint, which is how public showcase modals render project details.

### ResultsProjectLinks

**File:** `app/components/ResultsProjectLinks.vue`

Icon-based project link buttons for GitHub, demo, and video. The video button opens a `PopupMediaBrowser` with an embedded video player.

**Props:**

| Prop         | Type     | Description           |
| ------------ | -------- | --------------------- |
| `githubLink` | `string` | GitHub repository URL |
| `demoLink`   | `string` | Demo URL (optional)   |
| `videoLink`  | `string` | Video URL             |

```vue
<ResultsProjectLinks github-link="..." demo-link="..." video-link="..." />
```

### ShowcaseBeneathTheSurface

**File:** `app/components/showcase/BeneathTheSurface.vue`

Season 1's immersive winners experience. It fetches `/api/teams?season_id=1`, merges those public records with six frozen winner profiles, and renders one full-viewport chapter per project. Project-specific HTML and SVG scenes cover cyberpunk dialogue, a flooded pixel world, a night forest, a metadata inspector, fractured memories, and a third-party request graph.

The page uses locally hosted display fonts (registered in `nuxt.config.ts`, files in `public/fonts/`): **Unbounded** for the hero and closing headings, and a per-chapter display font wired through the `--display-font` custom property — **Orbitron** (Where the Rainbow Ends), **Silkscreen** (Beneath the Land), **Creepster** (Horror Forest), **Space Mono** (metadata manipulation tool), **Cormorant Garamond** (Unseen Layers), and **Chakra Petch** (TraceShadow).

Each chapter announces its result with a shimmering metallic medal (`#1` gold, `#2` silver, `#3` bronze — echoing the previous season's showcase) plus a pathway chip: a pulsing sonar dot next to the pathway label (junior or senior). Shimmer and ping animations are disabled under `prefers-reduced-motion`.

GSAP and ScrollTrigger are loaded after mount so server rendering remains safe. Responsive `matchMedia()` timelines pin and scrub sections only on desktop; reduced-motion visitors see the complete static composition. All timelines, ScrollTriggers, pointer handlers, and inline animation styles are reverted when the component unmounts.

## Awards

### AwardButton

**File:** `app/components/AwardButton.vue`

Hover popover button that renders an award icon. On hover, it shows the award name as a bold title and the description as the body. Maps award colors (`gold`, `silver`, `bronze`, or default) to `@nuxt/ui` button colors.

**Props:**

| Prop    | Type       | Description          |
| ------- | ---------- | -------------------- |
| `award` | `APIAward` | The award to display |
| `size`  | `any`      | Button size to apply |

```vue
<AwardButton :award="award" size="md" />
```

## Avatar System

### UserAvatar

**File:** `app/components/UserAvatar.vue`

Single user avatar with skeleton loading state. Resolves the image source from the user's `profile_picture` field (served from `/userast/`).

**Props:**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `user` | `object \| null \| undefined` | — | User object with `name`, `email`, `profile_picture` |
| `previewSrc` | `string` | — | Override source (e.g., for upload preview) |
| `size` | `'3xs' \| '2xs' \| 'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl' \| '3xl'` | `'md'` | Avatar size |

When `user` is `null`, renders a `USkeleton` placeholder.

```vue
<UserAvatar :user="user" size="sm" />
```

### UserAvatarGroup

**File:** `app/components/UserAvatarGroup.vue`

Renders multiple `UserAvatar` components in a `UAvatarGroup` with a hover popover listing all users.

**Props:**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `users` | `Array` | — | Array of user objects (`id`, `name`, `email`, `profile_picture`) |
| `size` | `string` | — | Avatar size (passed through) |
| `max` | `number \| string` | — | Maximum visible avatars |
| `class` | `any` | — | Classes passed to the group |
| `ui` | `any` | — | UI overrides for the group |
| `developerMode` | `boolean` | `false` | Shows each user's id in grayed `<id>` brackets beside their name in the popover |

The popover contains a scrollable list of `UserItem` components. When `developerMode` is enabled, a grayed `<id>` badge is rendered next to each user entry.

```vue
<UserAvatarGroup :users="members" :max="5" size="md" />
<UserAvatarGroup :users="members" :max="4" size="xs" developer-mode />
```

### UserItem

**File:** `app/components/UserItem.vue`

Combines a `UserAvatar` with the user's name and email text. Used inside popovers and lists.

**Props:**

| Prop   | Type                          | Default | Description |
| ------ | ----------------------------- | ------- | ----------- |
| `user` | `object \| null \| undefined` | —       | User object |
| `size` | `string`                      | `'md'`  | Avatar size |

```vue
<UserItem :user="user" size="sm" />
```

### UserPopover

**File:** `app/components/UserPopover.vue`

Hover-triggered popover that lazy-loads full user data on first hover. Shows the user's profile theme banner (if set), `UserItem`, an email copy button, and a "Chat on Teams" action.

**Props:**

| Prop | Type | Description |
| --- | --- | --- |
| `user` | `number \| APIUser` | User ID (lazy fetch) or full user object |
| `external` | `boolean` | When true, shows an indicator that the user is not registered in basishacks |

**Lazy loading:** If `user` is a number, fetches `/api/users/{id}` on first hover. Shows skeleton placeholders during loading. Caches the result after the first fetch.

```vue
<UserPopover :user="userId">
  <span>Hover to see profile</span>
</UserPopover>
```

## Countdown & Loading

### LargeCountdown

**File:** `app/components/LargeCountdown.vue`

Full-width countdown timer with days, hours, minutes, and seconds.

**Props:**

| Prop    | Type     | Description                  |
| ------- | -------- | ---------------------------- |
| `date`  | `Date`   | Target date to count down to |
| `label` | `string` | Label text above the timer   |

Updates every second via `setInterval`. Displays a formatted `DateTime` below the countdown. Styled with a dashed primary-colored border.

```vue
<LargeCountdown :date="startDate" label="Hackathon starts" />
```

### LoaderAnimation

**File:** `app/components/LoaderAnimation.vue`

Full-screen overlay loader with an animated infinity SVG symbol and "Just a moment" text. Uses a fade transition.

**Props:**

| Prop   | Type      | Description                   |
| ------ | --------- | ----------------------------- |
| `show` | `boolean` | Whether to display the loader |

The SVG animation features a looping stroke-dash animation on an infinity path, with shadow effects and a slow rotation.

```vue
<LoaderAnimation :show="isLoading" />
```

### LoaderAnimationInline

**File:** `app/components/LoaderAnimationInline.vue`

Inline version of the infinity SVG loader (same animation, no overlay). Used inside page content areas.

```vue
<LoaderAnimationInline />
```

## Security & Validation

### SafeLink

**File:** `app/components/SafeLink.vue`

An `<a>` tag that validates its `href` attribute through `isSafeUrl()` before rendering. Unsafe URLs (javascript:, data:, etc.) render as a `<span>` with muted strikethrough styling instead.

**Props:**

| Prop   | Type     | Description                     |
| ------ | -------- | ------------------------------- |
| `href` | `string` | The URL to validate and link to |

**Behavior:**

- **Safe external URL** (`http://` / `https://`) → renders `<a target="_blank" rel="noopener noreferrer">`
- **Safe same-origin URL** (starts with `/` but not `//`) → renders `<a>` without target/rel
- **Unsafe URL** (javascript:, data:, etc.) → renders `<span class="text-muted line-through">`

```vue
<SafeLink href="https://example.com">Visit</SafeLink>
<SafeLink href="javascript:alert(1)">This renders as span</SafeLink>
```

### SafeComark

**File:** `app/components/SafeComark.vue`

Wraps the `Comark` component (inline Markdown renderer) with XSS-safe configuration. Disables raw HTML (`html: false`) and replaces `<a>` tags with `SafeLink` to prevent unsafe links. Used wherever user-provided content is rendered (project descriptions, sourcing notes, etc.).

```vue
<SafeComark>{{ team.project.description }}</SafeComark>
```

### url-validation.ts

**File:** `app/utils/url-validation.ts`

Utility functions for safe URL validation used by `SafeLink` and other components.

Form input components (`ProjectForm.vue`, `JudgingCard.vue`, `voting.vue`) bind `:maxlength` to the exported `MAX_*` constants from `shared/schemas.ts` (e.g. `MAX_PROJECT_DESCRIPTION_LENGTH`, `MAX_REASONING_LENGTH`, `MAX_URL_LENGTH`), preventing users from exceeding validation limits before form submission.

| Function | Signature | Description |
| --- | --- | --- |
| `isSafeUrl` | `(url: string) => boolean` | Returns `true` for relative paths rooted at `/` (but not protocol-relative `//`) or for absolute `http://` / `https://` URLs. Returns `false` for empty strings. |
| `safeUrl` | `(url: string \| null \| undefined) => string \| undefined` | Returns the URL unchanged if safe, or `undefined` if null/unsafe. |

```ts
isSafeUrl("https://example.com"); // → true
isSafeUrl("/relative/path"); // → true
isSafeUrl("javascript:alert(1)"); // → false
safeUrl(null); // → undefined
```

---

## Utility Components

### ModalConfirm

**File:** `app/components/ModalConfirm.vue`

Reusable confirmation modal wrapping `UModal`.

**Props:**

| Prop          | Type       | Default     | Description                 |
| ------------- | ---------- | ----------- | --------------------------- |
| `color`       | `string`   | `'primary'` | Color of the confirm button |
| `click`       | `Function` | `() => {}`  | Callback on confirm         |
| `colorSecond` | `string`   | `'neutral'` | Color of the cancel button  |

**Slots:**

- Default — trigger element (e.g., a button)
- `content` — modal body content

**v-model:** Supports `v-model:open` for programmatic control.

```vue
<ModalConfirm v-model:open="show" title="Confirm" color="error" :click="onConfirm">
  <UButton>Delete</UButton>
  <template #content>Are you sure?</template>
</ModalConfirm>
```

### PopupMediaBrowser

**File:** `app/components/PopupMediaBrowser.vue`

Modal-based media preview browser wrapping `UModal`.

**Props:**

| Prop            | Type      | Default                            | Description                 |
| --------------- | --------- | ---------------------------------- | --------------------------- |
| `title`         | `string`  | `'Media preview'`                  | Modal title                 |
| `buttonLabel`   | `string`  | `'Open media'`                     | Default trigger button text |
| `buttonIcon`    | `string`  | `'i-material-symbols-open-in-new'` | Trigger button icon         |
| `buttonVariant` | `string`  | `'ghost'`                          | Trigger button variant      |
| `disabled`      | `boolean` | `false`                            | Disables the trigger        |

**Slots:**

- `trigger` — custom trigger element
- `buttonLabel` — custom button label
- Default (scoped) — receives `close` function for modal content

```vue
<PopupMediaBrowser title="Video" :disabled="!videoLink">
  <template #buttonLabel>Watch</template>
  <template #default="{ close }">
    <video :src="videoLink" controls />
  </template>
</PopupMediaBrowser>
```

### DateTime

**File:** `app/components/DateTime.vue`

Formats a date-like input as a localized string in the `Asia/Shanghai` timezone.

**Props:**

| Prop   | Type                       | Description                                                |
| ------ | -------------------------- | ---------------------------------------------------------- |
| `date` | `Date \| string \| number` | A native date, ISO string, or epoch milliseconds to format |

Accepts a native `Date`, ISO date string, or epoch milliseconds. It normalizes the input before formatting with `toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })`; invalid or missing input renders `Date unavailable` without an ISO attribute. Wrapped in `<ClientOnly>` to avoid hydration mismatches. Valid values render a `<time>` element with an ISO `datetime` attribute.

```vue
<DateTime :date="startDate" />
```

### GoBackUp

**File:** `app/components/GoBackUp.vue`

Scroll-to-top floating button. Appears when the user scrolls past one viewport height. Uses a fade transition.

```vue
<GoBackUp />
```

### FormRequiredNotification

**File:** `app/components/FormRequiredNotification.vue`

Static helper text indicating required form fields. Displays a red asterisk icon with the message "indicates a field is required."

```vue
<FormRequiredNotification />
```
