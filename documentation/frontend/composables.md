---
title: Composables & Utilities
description: Shared composables, middleware, constants, error handling, and cross-cutting patterns used across the basishacks frontend.
---

# Composables & Utilities

The basishacks frontend organizes shared logic into composables (`app/composables/`), route middleware (`app/middleware/`), utility functions (`app/utils/`), and app configuration (`app/app.config.ts`). The encrypted HTTP-only cookie holds basis-auth tokens on the server. `useBasisAuthSession()` exposes a browser-safe session summary; `app/plugins/api.client.ts` injects bearer headers, unwraps `APIResponse.data`, parses `APIError` envelopes, and performs one single-flight refresh-and-retry after an expired-token response. A failed refresh clears local authentication and restarts login.

## Composables

### useApiUser

**File:** `app/composables/useApiUser.ts`

Fetches the current authenticated user from the API and returns reactive state. It reads the identity from `useBasisAuthSession()` and guards against a missing user id so it never requests `/api/users/undefined`.

```ts
export async function useApiUser(options?: { lazy?: boolean }): Promise<UseApiUserResult> {
    const { user: sessionUser, clear: clearSession } = useBasisAuthSession();
    const userID = computed(() => sessionUser.value?.id);

    const fetchResult = await useFetch<ApiUser>(() => `/api/users/${userID.value}`, {
        lazy: options?.lazy ?? false,
        immediate: !!userID.value,
        watch: [userID],
        server: false,
        default: () => null,
    });

    if (!options?.lazy && userID.value && !fetchResult.data.value) {
        if (fetchResult.status.value === "idle") {
            await fetchResult.refresh();
        }

        if (fetchResult.status.value === "pending") {
            await new Promise<void>((resolve) => {
                const stop = watch(fetchResult.status, (status) => {
                    if (status !== "pending") {
                        stop();
                        resolve();
                    }
                });
            });
        }
    }

    return {
        ...fetchResult,
        user: fetchResult.data,
        sessionUser,
        clear: clearSession,
    };
}
```

**Returns:**

| Property | Type | Description |
| --- | --- | --- |
| `user` | `Ref<GetUserResponse \| null>` | Reactive user data from `/api/users/{id}` (alias for `data`) |
| `sessionUser` | `Ref<{ id: number } \| null>` | Browser-safe identity from `useBasisAuthSession()` |
| `status` | `Ref<AsyncDataRequestStatus>` | Request status (`idle`, `pending`, `success`, `error`) |
| `error` | `Ref<FetchError \| null>` | Fetch error, if any |
| `pending` | `Ref<boolean>` | Whether the request is in flight |
| `refresh` | `() => Promise<void>` | Re-fetch the user data |
| `clear` | `() => Promise<void>` | Call `/api/auth/logout` and clear local session state |

**Usage:**

```vue
<script setup lang="ts">
const { user, sessionUser, refresh, clear } = await useApiUser({ lazy: true });
</script>

<template>
    <p v-if="user">{{ user.name }}</p>
</template>
```

::: tip The browser session summary contains only the user ID, permissions, and expiry. Tokens remain inside the encrypted HTTP-only cookie. `useApiUser()` combines that summary with the full user fetch, giving pages and components access to role, team, and profile data. Pass `{ lazy: true }` to avoid blocking navigation. :::

## Route Middleware

### auth

**File:** `app/middleware/auth.ts`

Global route middleware that refreshes the browser-safe basis-auth session summary before redirecting unauthenticated users to the login endpoint, preserving the originally requested URL.

```ts
export default defineNuxtRouteMiddleware(async (to) => {
    const { ready, loggedIn, refresh } = useBasisAuthSession();

    if (!ready.value || !loggedIn.value) await refresh();

    if (!loggedIn.value) {
        return navigateTo(`/api/login?redirect=${encodeURIComponent(to.fullPath)}`, {
            external: true,
        });
    }
});
```

**Behavior:**

- Refreshes the browser-safe session summary from `/api/auth/session` when needed
- Checks `loggedIn` from `useBasisAuthSession()`
- If not logged in, redirects to `/api/login` with a `redirect` query parameter (external navigation)
- Applied per-page via `definePageMeta({ middleware: 'auth' })` or `middleware: ['auth']`

**Pages using this middleware:** `/profile`, `/voting`, `/judging`, `/judging/continue`, all `/dashboard/*` pages, `/debug`

## Utility Functions

### consts.ts

**File:** `app/utils/consts.ts`

Global constants used throughout the frontend.

```ts
export const WEBSITE_NAME = "basishacks";
//export const THEME_NAME = "nostalgia"; used for testing
```

| Constant       | Value          | Usage                                                   |
| -------------- | -------------- | ------------------------------------------------------- |
| `WEBSITE_NAME` | `'basishacks'` | Displayed in headers, page titles, and welcome messages |

`THEME_NAME` is currently commented out and not used. These constants are auto-imported by Nuxt and available in any component or page.

### errors.ts

**File:** `app/utils/errors.ts`

Error message extraction utility for consistent error handling.

```ts
import { FetchError } from "ofetch";

export function getErrorMessage(e: unknown) {
    try {
        if (e instanceof FetchError) {
            console.log(e.message, e.data, e.stack, e.statusMessage);
            try {
                if (e.data) {
                    if ("message" in e.data && e.data.message) {
                        return String(e.data.message);
                    }
                }
            } catch {
                return e.message;
            }
            return e.message;
        }
        return String(e);
    } catch (inner) {
        console.error("Error trying to get error message:", inner);
        return String(e);
    }
}
```

**Behavior:**

- If the error is a `FetchError` (from `ofetch`/`$fetch`), extracts `e.data.message` first, then falls back to `e.message`
- For non-`FetchError` errors, returns `String(e)`
- Wrapped in try/catch to handle edge cases where error extraction itself fails

**Usage pattern:**

```ts
try {
    await $fetch("/api/teams", { method: "POST", body });
} catch (e) {
    toast.add({
        color: "error",
        title: "Failed to create team",
        description: getErrorMessage(e),
    });
}
```

### loading.ts

**File:** `app/utils/loading.ts`

Wraps async operations with the Nuxt loading indicator.

```ts
export async function withLoadingIndicator<T>(func: () => T): Promise<T> {
    const loadingIndicator = useLoadingIndicator();
    loadingIndicator.start();
    try {
        const res = await func();
        loadingIndicator.finish();
        return res;
    } catch (e) {
        loadingIndicator.finish({ error: true });
        throw e;
    }
}
```

**Behavior:**

- Starts the Nuxt top-bar loading indicator before the operation
- Finishes the indicator on success
- Finishes with `error: true` on failure (shows red indicator)
- Re-throws the error so callers can handle it

**Usage pattern:**

```ts
await withLoadingIndicator(async () => {
    const res = await $fetch("/api/teams", { method: "POST", body });
    toast.add({ color: "success", title: res.message });
});
```

### oauth2.ts

### sanitize.ts

**File:** `app/utils/sanitize.ts`

Escapes HTML special characters to prevent XSS when rendering untrusted text.

```ts
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
```

Used by the home page to safely render the hackathon theme description and by the OAuth2 authorization page when formatting error messages.

## App Configuration

### app.config.ts

**File:** `app/app.config.ts`

Customizes `@nuxt/ui` component defaults.

```ts
export default defineAppConfig({
    ui: {
        container: {
            base: "w-full max-w-none px-4 sm:px-6 lg:px-8",
        },
        formField: {
            slots: {
                label: "block bold text-default",
            },
        },
        link: {
            variants: {
                active: {
                    false: "text-primary",
                },
            },
        },
    },
});
```

| Customization | Description |
| --- | --- |
| `container.base` | Full-width container with horizontal padding and no max-width constraint |
| `formField.slots.label` | Makes all form field labels bold with default text color |
| `link.variants.active.false` | Primary color for inactive links (overrides default muted style) |

::: tip The container configuration removes the default max-width so the header, footer, and content span the viewport. :::

## Cross-Cutting Patterns

### Zod Form Validation

All forms use `@nuxt/ui`'s `UForm` component with Zod schemas from `~~/shared/schemas`:

```vue
<UForm :state="state" :schema="SubmitTeamRequest" @submit="onSubmit">
  <UFormField name="name" label="Project name">
    <UInput v-model="state.name" />
  </UFormField>
</UForm>
```

The `:schema` prop enables automatic field-level validation. Schemas are shared between client and server via `shared/schemas.ts`.

### Try/Catch with Toast

The standard error handling pattern across all pages and components:

```ts
try {
    await withLoadingIndicator(async () => {
        const res = await $fetch("/api/...", { method: "POST", body });
        toast.add({ color: "success", title: res.message });
    });
} catch (e) {
    toast.add({
        color: "error",
        title: "Operation failed",
        description: getErrorMessage(e),
    });
}
```

### Permission Gating

Role-based access control is enforced at two levels:

1. **Server-side** — `requireUser`, `requireJudge`, `requireAdmin` in `server/utils/auth.ts`
2. **Client-side** — `useNethackPermissions()` for display-only UI conditionals

```vue
<script setup>
import { NethackPermissions } from "~~/shared/permissions";

const showJudging = computed(() =>
    useNethackPermissions().can(NethackPermissions.Judging.assignmentsRead),
);
</script>

<template>
    <JudgingCard v-if="showJudging" />
</template>
```

::: warning Client-side permission checks are for UI display only. All authorization is enforced server-side. :::

### Unsaved Changes Protection

Pages with editable forms (dashboard index, dashboard general) implement a two-layer protection:

```ts
const isDirty = ref(false);

// Route navigation guard
onBeforeRouteLeave(() => {
    if (isDirty.value && !confirm("You have unsaved changes. Are you sure you want to leave?")) {
        return abortNavigation();
    }
});

// Browser close/refresh guard
function beforeUnload(event: BeforeUnloadEvent) {
    if (isDirty.value) {
        event.preventDefault();
        event.returnValue = true;
    }
}

watch(isDirty, (value) => {
    if (value) {
        window.addEventListener("beforeunload", beforeUnload);
    } else {
        window.removeEventListener("beforeunload", beforeUnload);
    }
});

onUnmounted(() => {
    window.removeEventListener("beforeunload", beforeUnload);
});
```

### Auto-Save

The `ProjectForm` component implements auto-save with a 10-second interval:

```ts
let autosaveInterval: ReturnType<typeof setInterval> | null = null;

async function triggerAutosave() {
    if (!formRef.value?.dirty || !defaultTeam) return;
    autosaveStatus.value = "Auto-saving...";
    try {
        await $fetch(`/api/teams/${defaultTeam.id}`, {
            method: "PATCH",
            body: {/* form data */},
        });
        autosaveStatus.value = `Auto-saved at ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        autosaveStatus.value = "Auto-save failed";
    }
}

onMounted(() => {
    autosaveInterval = setInterval(triggerAutosave, 10000);
});

onUnmounted(() => {
    if (autosaveInterval) clearInterval(autosaveInterval);
});
```

::: tip Auto-save only triggers when the form is dirty. The status message is displayed below the form buttons to give users feedback. :::
