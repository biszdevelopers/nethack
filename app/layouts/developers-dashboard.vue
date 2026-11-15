<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { NethackPermissions } from "~~/shared/permissions";

const { user, status } = await useApiUser({ lazy: true });
const { can } = useNethackPermissions();

const isAdmin = computed(() => can(NethackPermissions.all));

if (status.value !== "idle" && status.value !== "pending") {
    if (!isAdmin.value) {
        throw createError({ statusCode: 403, statusMessage: "Access Denied" });
    }
}

const sidebarGroups = computed<Array<{ id: string; label: string; items: NavigationMenuItem[] }>>(
    () => [
        {
            id: "event",
            label: "Event",
            items: [
                { label: "Overview", icon: "i-lucide-house", to: "/developers" },
                { label: "Hackathon", icon: "i-lucide-flag", to: "/developers/season" },
            ],
        },
        {
            id: "people",
            label: "People",
            items: [
                { label: "Users", icon: "i-lucide-user", to: "/developers/users" },
                { label: "Teams", icon: "i-lucide-users", to: "/developers/teams" },
            ],
        },
        {
            id: "tools",
            label: "Tools",
            items: [
                { label: "Files", icon: "i-lucide-files", to: "/developers/debug" },
                {
                    label: "DeepSeek",
                    icon: "i-lucide-message-square",
                    to: "/developers/deepseek",
                },
            ],
        },
    ],
);

const searchGroups = computed(() => [
    {
        id: "pages",
        label: "Pages",
        items: sidebarGroups.value.flatMap((group) =>
            group.items.map((item) => ({
                label: `${group.label} / ${item.label}`,
                icon: item.icon,
                to: item.to,
            })),
        ),
    },
]);

const name = computed(() => user.value?.name || "Log In");
</script>

<template>
    <UDashboardGroup>
        <UDashboardSearch :groups="searchGroups" />

        <UDashboardSidebar collapsible resizable :ui="{ footer: 'border-t border-default' }">
            <template #header="{ collapsed }">
                <div class="flex items-center gap-1">
                    <ULink v-if="!collapsed" class="bold glow text-primary mx-auto" to="/">
                        {{ WEBSITE_NAME }}
                        <span class="text-secondary bold">devs</span>
                    </ULink>
                    <UButton
                        v-else-if="collapsed"
                        variant="ghost"
                        class="bold glow text-primary mx-auto"
                        @click="() => void navigateTo('/')"
                    >
                        b
                    </UButton>
                </div>
            </template>

            <template #default="{ collapsed }">
                <UDashboardSearchButton :collapsed="collapsed" class="mb-1" />

                <nav aria-label="Mod portal" class="space-y-3">
                    <div v-for="group in sidebarGroups" :key="group.id" class="space-y-1">
                        <p
                            v-if="!collapsed"
                            class="px-2 text-xs font-semibold uppercase tracking-wide text-ui-text-muted"
                        >
                            {{ group.label }}
                        </p>
                        <UNavigationMenu
                            :collapsed="collapsed"
                            :items="group.items"
                            orientation="vertical"
                        />
                    </div>
                </nav>
            </template>

            <template #footer="{ collapsed }">
                <UButton
                    :avatar="{
                        src: user?.id ? `/api/users/${user.id}/profile_picture` : undefined,
                        alt: name,
                        loading: 'lazy' as const,
                    }"
                    :label="collapsed ? undefined : name"
                    color="neutral"
                    variant="ghost"
                    class="w-full"
                    :block="collapsed"
                    @click="() => void navigateTo('/profile')"
                />
            </template>
        </UDashboardSidebar>

        <slot />
    </UDashboardGroup>
</template>
