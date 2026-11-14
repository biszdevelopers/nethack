<template>
    <UHeader
        :toggle="{ class: 'min-h-11 min-w-11' }"
        :ui="{ title: 'min-h-11', toggle: 'min-h-11 min-w-11' }"
    >
        <template #title>
            <span class="text-base text-primary sm:text-xl">basishacks_2026</span>
        </template>

        <UNavigationMenu :items="navItems" />

        <template #right>
            <UColorModeButton class="hidden min-h-11 min-w-11 sm:inline-flex" />
            <UButton
                variant="ghost"
                :class="[profileIconColor, 'min-h-11 min-w-11']"
                href="/profile"
                :aria-label="userRef ? 'Open your profile' : 'Sign in'"
            >
                <template v-if="userRef">
                    <UserAvatar :user="user" size="sm" />
                </template>
                <UIcon v-else name="i-material-symbols-account-circle-full" class="text-xl" />
            </UButton>
        </template>

        <template #body>
            <UNavigationMenu
                :items="navItems"
                orientation="vertical"
                class="-mx-2.5"
                :ui="{ link: 'min-h-11' }"
            />
            <div class="mt-3 border-t border-default px-2.5 pt-3 sm:hidden">
                <UColorModeButton class="min-h-11 min-w-11" />
            </div>
        </template>
    </UHeader>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { NethackPermissions } from "~~/shared/permissions";

const { user, sessionUser: userRef } = await useApiUser({ lazy: true });
const { can } = useNethackPermissions();
const { data: hackathon } = useApiFetch("/api/seasons/active", {
    lazy: true,
    $fetch: globalThis.$fetch,
});

const profileIconColor = computed(() => {
    return userRef.value ? "text-primary" : "text-ui-muted";
});

const dashboardContent: NavigationMenuItem[] = [
    {
        label: "Overview",
        icon: "i-lucide-info",
        to: "/dashboard",
    },

    {
        label: "General",
        icon: "i-lucide-file-text",
        to: "/dashboard/general",
    },

    {
        label: "Teams",
        icon: "i-fluent-people-team-16-filled",
        to: "/dashboard/teams",
    },

    {
        label: "Results",
        icon: "i-lucide-trophy",
        to: "/dashboard/results",
    },
];

const navItems = computed<NavigationMenuItem[]>(() => {
    const links = [
        {
            label: "Home",
            to: "/",
            icon: "i-material-symbols-home-outline",
        },
        {
            label: "Dashboard",
            to: "/dashboard",
            icon: "i-material-symbols-space-dashboard",
            children: dashboardContent,
        },
        {
            label: "Showcase",
            to: "/showcase",
            icon: "i-lucide-spotlight",
        },
    ];
    if (hackathon.value?.status === "voting" && !can(NethackPermissions.Judging.assignmentsRead)) {
        links.push({
            label: "Voting",
            to: "/voting",
            icon: "i-material-symbols-star-rate",
        });
    }
    if (can(NethackPermissions.Judging.assignmentsRead) && hackathon.value?.status === "voting") {
        links.push({
            label: "Judging",
            to: "/judging",
            icon: "i-material-symbols-gavel",
        });
    }
    return links;
});
</script>
