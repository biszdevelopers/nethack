<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { formatDateTime } from "~/utils/datetime";

definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

useHead({ title: `Notifications | ${WEBSITE_NAME}` });

const toast = useToast();
const working = ref<number | "all" | null>(null);

const { data, pending, error, refresh } = await useApiFetch<GetNotificationsResponse>(
    "/api/notifications",
    { server: false },
);

function normalizeNotifications(payload: unknown): NotificationResponse[] {
    if (Array.isArray(payload)) return payload as NotificationResponse[];
    const list = (payload as { notifications?: NotificationResponse[] } | null)?.notifications;
    return Array.isArray(list) ? list : [];
}

const notifications = computed(() => normalizeNotifications(data.value));
const unreadCount = computed(() => {
    const reported = (data.value as { unread?: number } | null)?.unread;
    if (typeof reported === "number" && Number.isFinite(reported)) return Math.max(0, reported);
    return notifications.value.filter((item) => !item.read_at).length;
});

/** Notification links stay on this site; unknown or external values are rendered as text. */
function safeInternalPath(link: string | null | undefined): string | undefined {
    if (!link || !link.startsWith("/") || !isSafeUrl(link)) return undefined;
    return link;
}

async function markRead(notification: NotificationResponse) {
    if (notification.read_at || working.value !== null) return;
    working.value = notification.id;
    try {
        await apiFetch(`/api/notifications/${notification.id}/read`, { method: "PATCH" });
        await refresh();
    } catch (e) {
        toast.add({
            color: "error",
            title: "Could not mark the notification read",
            description: getErrorMessage(e),
        });
    } finally {
        working.value = null;
    }
}

async function markAllRead() {
    if (working.value !== null || unreadCount.value === 0) return;
    working.value = "all";
    try {
        await apiFetch("/api/notifications/read-all", { method: "PATCH" });
        await refresh();
        toast.add({ color: "success", title: "All notifications marked read" });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Could not mark notifications read",
            description: getErrorMessage(e),
        });
    } finally {
        working.value = null;
    }
}
</script>

<template>
    <div class="mx-auto w-full max-w-3xl pb-8">
        <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 class="text-3xl font-bold text-primary glow sm:text-4xl">Notifications</h1>
                <p class="mt-2 text-muted">
                    Team invitations, roster changes, and organizer updates.
                </p>
            </div>
            <div class="flex items-center gap-2">
                <UBadge variant="subtle" color="neutral">{{ unreadCount }} unread</UBadge>
                <UButton
                    variant="outline"
                    class="min-h-11"
                    :disabled="unreadCount === 0 || working !== null"
                    :loading="working === 'all'"
                    @click="markAllRead"
                >
                    Mark all read
                </UButton>
            </div>
        </div>

        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            title="Notifications could not be loaded"
            :description="getErrorMessage(error)"
            class="mb-4"
        >
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="() => refresh()">
                    Try again
                </UButton>
            </template>
        </UAlert>

        <p v-else-if="pending" class="text-muted" aria-live="polite">Loading notifications…</p>

        <div
            v-else-if="notifications.length === 0"
            class="rounded-xl border border-default p-6 text-sm text-muted"
        >
            You have no notifications yet. Team invitations and organizer updates appear here.
        </div>

        <ul v-else class="space-y-3">
            <li
                v-for="notification in notifications"
                :key="notification.id"
                class="rounded-xl border p-4"
                :class="notification.read_at ? 'border-default' : 'border-primary/40 bg-primary/5'"
            >
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="break-words font-semibold">
                            {{ notification.title }}
                            <UBadge v-if="!notification.read_at" size="sm" variant="subtle">
                                Unread
                            </UBadge>
                        </p>
                        <p v-if="notification.body" class="mt-1 break-words text-sm text-muted">
                            {{ notification.body }}
                        </p>
                        <time
                            class="mt-2 block text-xs text-muted"
                            :datetime="notification.created_at"
                        >
                            {{ formatDateTime(notification.created_at) }}
                        </time>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            v-if="safeInternalPath(notification.link)"
                            :to="safeInternalPath(notification.link)"
                            variant="subtle"
                            class="min-h-11"
                            trailing-icon="i-lucide-arrow-right"
                            @click="markRead(notification)"
                        >
                            Open
                        </UButton>
                        <UButton
                            v-if="!notification.read_at"
                            variant="ghost"
                            class="min-h-11"
                            :loading="working === notification.id"
                            :disabled="working !== null"
                            @click="markRead(notification)"
                        >
                            Mark read
                        </UButton>
                    </div>
                </div>
            </li>
        </ul>
    </div>
</template>
