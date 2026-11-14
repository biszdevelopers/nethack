---
title: Layouts
description: Nuxt layouts used across the basishacks frontend — default, dashboard, fullwidth, and mod portal.
---

# Layouts

The basishacks frontend defines **6 layouts** in `app/layouts/`. Layouts are selected per-page via `definePageMeta({ layout: '...' })` or `setPageLayout()`.

## default

**File:** `app/layouts/default.vue`

The standard page layout used by most public pages.

**Structure:**

```
┌──────────────────────────────┐
│ RoleHeader                   │
├──────────────────────────────┤
│ UMain                        │
│   <div class="mx-auto        │
│         max-w-7xl px-4 ..."> │
│     <slot />                 │
│                              │
├──────────────────────────────┤
│ Footer                       │
└──────────────────────────────┘
```

- `RoleHeader` — sticky navigation header with role-based menu items
- Content wrapper — centered `div` with `max-w-7xl` (1280px). Fills full viewport width on screens under 1280px; centered above that.
- `Footer` — site-wide footer with links and copyright
- A keyboard-visible **Skip to main content** link moves focus to the `UMain` landmark.

**Used by:** `/`, `/profile`, `/rules`, `/voting`, `/judging`, `/judging/continue`

## default-background

**File:** `app/layouts/default-background.vue`

Identical to `default` but with a **red background** (`bg-red-100`) on the `UMain` element, plus the same `mx-auto max-w-7xl` centered container. Used for debugging or visual testing.

::: warning This layout is intended for development only and should not be used in production pages. :::

## fullwidth

**File:** `app/layouts/fullwidth.vue`

Same header/footer structure as `default`, but **without** the inner padded container. The slot content spans the full viewport width.

**Structure:**

```
┌──────────────────────────────┐
│ RoleHeader                   │
├──────────────────────────────┤
│ UMain                        │
│   <slot />  (no container)   │
│                              │
├──────────────────────────────┤
│ Footer                       │
└──────────────────────────────┘
```

**Used by:** `/user/[id]` (set programmatically via `setPageLayout`)

## fullwidth-nostick

**File:** `app/layouts/fullwidth-nostick.vue`

Same as `fullwidth` but with a **non-sticky** header (`class="relative"` on `RoleHeader`). The header scrolls with the page content instead of remaining fixed at the top.

**Structure:**

```
┌──────────────────────────────┐
│ RoleHeader (relative)        │
├──────────────────────────────┤
│ UMain                        │
│   <slot />  (no container)   │
│                              │
├──────────────────────────────┤
│ Footer                       │
└──────────────────────────────┘
```

**Used by:** `/showcase`, `/showcase/beneath-the-surface`, and `/showcase/signal` — showcase pages need the header to scroll away for an immersive full-screen experience.

## dashboard

**File:** `app/layouts/dashboard.vue`

Participant dashboard layout with a visible left sidebar containing the active phase card and vertical navigation, plus a full-width main content area.

**Structure:**

```
┌──────────────────────────────────────────────────┐
│ RoleHeader                                       │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │ Main content                          │
│ (aside)  │   UBanner (small screens)             │
│          │   <slot />                            │
│          │                                       │
├──────────┴───────────────────────────────────────┤
│ Footer                                           │
└──────────────────────────────────────────────────┘
```

**Sidebar contents:**

- Phase info card — shows "ongoing"/"completed" label, season date, theme name, and event details link
- Navigation menu with items:
    - **Dashboard** (label)
    - Overview → `/dashboard`
    - Team → `/dashboard/teams`
    - General → `/dashboard/general`
    - Results → `/dashboard/results`
    - Help → external Microsoft Teams Q&A channel

**Responsive behavior:**

- On large screens, the sidebar is rendered as a fixed-width aside on the left and the main content fills the remaining width
- On small screens, the sidebar stacks above the main content
- A keyboard-visible skip link focuses the main landmark; mobile navigation links have 44px minimum touch height and visible keyboard focus.
- A `UBanner` notification can appear on small screens with guidance about dashboard navigation

**CSS:** Includes `metallic-gold`, `metallic-silver`, and `metallic-bronze` shimmer animations for season info display.

**Used by:** `/dashboard`, `/dashboard/general`, `/dashboard/teams`, `/dashboard/results`, `/dashboard/presentation`

## developers-dashboard

**File:** `app/layouts/developers-dashboard.vue`

Mod portal layout using `UDashboardGroup` with a collapsible, resizable sidebar.

**Structure:**

```
┌──────────────────────────────────────────────────┐
│ UDashboardGroup                                  │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │ <slot />                              │
│ (collaps │                                       │
│  ible)   │                                       │
│          │                                       │
├──────────┴───────────────────────────────────────┤
│ (no footer)                                      │
└──────────────────────────────────────────────────┘
```

**Sidebar sections:**

| Section    | Content                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| Header     | "{{ WEBSITE_NAME }} devs" link (collapses to "b" when sidebar is minimized) |
| Search     | Search button with ⌘K keyboard shortcut hint                                |
| Navigation | Permission-gated menu items                                                 |
| Footer     | User avatar button linking to `/profile`                                    |

**Navigation and access rules:**

| Item                                        | Route           | Permission Required |
| ------------------------------------------- | --------------- | ------------------- |
| Home, Users, Teams, DeepSeek, Files, Season | `/developers/*` | Admin               |

The retired application-management navigation is no longer present. All remaining developer routes require admin access.

**Used by:** `/developers`, `/developers/users`, `/developers/teams`, `/developers/deepseek`, `/developers/debug`, `/developers/season`

## Layout Comparison

| Layout | Header | Inner Container | Footer | Sidebar | Sticky Header |
| --- | --- | --- | --- | --- | --- |
| `default` | RoleHeader | Padded `div` | Footer | — | Yes |
| `default-background` | RoleHeader | Padded `div` (red bg) | Footer | — | Yes |
| `fullwidth` | RoleHeader | None | Footer | — | Yes |
| `fullwidth-nostick` | RoleHeader | None | Footer | — | No |
| `dashboard` | RoleHeader | Padded `div` | Footer | Visible left | Yes |
| `developers-dashboard` | — | None | — | Collapsible | — |
