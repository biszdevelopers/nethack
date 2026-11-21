<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { formatDateTime } from "~/utils/datetime";

const { loggedIn } = useBasisAuthSession();
const toast = useToast();

const { data, pending, error, refresh } = await useApiFetch<GetNotificationsResponse>(
    "/api/notifications",
    {
        server: false,
        lazy: true,
        immediate: loggedIn.value,
    },
);

const open = ref(false);
const working = ref<number | "all" | null>(null);
const lastLoadedAt = ref(0);

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
const badgeLabel = computed(() => (unreadCount.value > 9 ? "9+" : String(unreadCount.value)));

/** Only relative paths may render as links; notification links never leave the site. */
function safeInternalPath(link: string | null | undefined): string | undefined {
    if (!link || !link.startsWith("/") || !isSafeUrl(link)) return undefined;
    return link;
}

async function loadIfStale(minAge: number) {
    if (!loggedIn.value) return;
    if (pending.value) return;
    if (Date.now() - lastLoadedAt.value < minAge) return;
    lastLoadedAt.value = Date.now();
    await refresh().catch(() => undefined);
}

function onWindowFocus() {
    void loadIfStale(60_000);
}

function onVisibilityChange() {
    if (document.visibilityState === "visible") void loadIfStale(60_000);
}

async function markRead(notification: NotificationResponse) {
    if (notification.read_at || working.value !== null) return;
    working.value = notification.id;
    try {
        await apiFetch(`/api/notifications/${notification.id}/read`, { method: "PATCH" });
        await refresh();
        lastLoadedAt.value = Date.now();
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
        lastLoadedAt.value = Date.now();
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

watch(open, (isOpen) => {
    if (isOpen) void loadIfStale(30_000);
});

watch(loggedIn, (signedIn) => {
    if (signedIn) void refresh().catch(() => undefined);
});

onMounted(() => {
    lastLoadedAt.value = Date.now();
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
    window.removeEventListener("focus", onWindowFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
    <UPopover v-if="loggedIn" v-model:open="open">
        <UButton
            variant="ghost"
            color="neutral"
            class="relative min-h-11 min-w-11"
            :aria-label="unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'"
        >
            <UIcon name="i-lucide-bell" class="text-xl" aria-hidden="true" />
            <span
                v-if="unreadCount > 0"
                class="pointer-events-none flex min-h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[0.65rem] font-bold leading-none text-inverted"
                aria-hidden="true"
            >
                {{ badgeLabel }}
            </span>
        </UButton>

        <template #content>
            <div class="w-[min(22rem,calc(100vw-2rem))]">
                <div class="flex items-center justify-between gap-2 border-b border-default p-3">
                    <div>
                        <p class="font-semibold">Notifications</p>
                        <p class="text-xs text-muted">
                            {{ unreadCount }} unread
                            {{ unreadCount === 1 ? "notification" : "notifications" }}
                        </p>
                    </div>
                    <UButton
                        size="xs"
                        variant="ghost"
                        class="min-h-11"
                        :disabled="unreadCount === 0 || working !== null"
                        :loading="working === 'all'"
                        @click="markAllRead"
                    >
                        Mark all read
                    </UButton>
                </div>

                <div class="max-h-96 overflow-y-auto">
                    <p v-if="pending && notifications.length === 0" class="p-4 text-sm text-muted">
                        Loading notifications…
                    </p>
                    <div v-else-if="error && notifications.length === 0" class="p-4">
                        <p class="text-sm text-error">Notifications could not be loaded.</p>
                        <UButton
                            size="xs"
                            variant="outline"
                            class="mt-2 min-h-11"
                            @click="() => refresh()"
                        >
                            Try again
                        </UButton>
                    </div>
                    <p v-else-if="notifications.length === 0" class="p-4 text-sm text-muted">
                        You have no notifications yet.
                    </p>
                    <ul v-else class="divide-y divide-default">
                        <li v-for="notification in notifications" :key="notification.id">
                            <NuxtLink
                                v-if="safeInternalPath(notification.link)"
                                :to="safeInternalPath(notification.link)"
                                class="block p-3 transition hover:bg-elevated"
                                :class="{ 'bg-primary/5': !notification.read_at }"
                                @click="markRead(notification)"
                            >
                                <div class="flex items-start gap-2">
                                    <span
                                        class="mt-1.5 size-2 shrink-0 rounded-full"
                                        :class="
                                            notification.read_at ? 'bg-transparent' : 'bg-primary'
                                        "
                                        aria-hidden="true"
                                    />
                                    <div class="min-w-0">
                                        <p class="break-words text-sm font-medium">
                                            {{ notification.title }}
                                        </p>
                                        <p
                                            v-if="notification.body"
                                            class="mt-0.5 break-words text-xs text-muted"
                                        >
                                            {{ notification.body }}
                                        </p>
                                        <time
                                            class="mt-1 block text-xs text-muted"
                                            :datetime="notification.created_at"
                                        >
                                            {{ formatDateTime(notification.created_at) }}
                                        </time>
                                    </div>
                                </div>
                            </NuxtLink>
                            <div
                                v-else
                                class="block p-3"
                                :class="{ 'bg-primary/5': !notification.read_at }"
                            >
                                <div class="flex items-start gap-2">
                                    <span
                                        class="mt-1.5 size-2 shrink-0 rounded-full"
                                        :class="
                                            notification.read_at ? 'bg-transparent' : 'bg-primary'
                                        "
                                        aria-hidden="true"
                                    />
                                    <div class="min-w-0">
                                        <p class="break-words text-sm font-medium">
                                            {{ notification.title }}
                                        </p>
                                        <p
                                            v-if="notification.body"
                                            class="mt-0.5 break-words text-xs text-muted"
                                        >
                                            {{ notification.body }}
                                        </p>
                                        <time
                                            class="mt-1 block text-xs text-muted"
                                            :datetime="notification.created_at"
                                        >
                                            {{ formatDateTime(notification.created_at) }}
                                        </time>
                                    </div>
                                </div>
                            </div>
                        </li>
                    </ul>
                </div>

                <div class="border-t border-default p-2">
                    <UButton
                        to="/notifications"
                        variant="ghost"
                        block
                        class="min-h-11"
                        @click="open = false"
                    >
                        View all notifications
                    </UButton>
                </div>
            </div>
        </template>
    </UPopover>
</template>
