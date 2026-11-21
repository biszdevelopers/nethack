<template>
    <UHeader
        :toggle="{ class: 'min-h-11 min-w-11' }"
        :ui="{ title: 'min-h-11 items-center', toggle: 'min-h-11 min-w-11' }"
    >
        <template #title>
            <span class="flex items-center text-base leading-none text-primary sm:text-xl">
                {{ WEBSITE_NAME }}
            </span>
        </template>

        <UNavigationMenu :items="navItems" />

        <template #right>
            <UColorModeButton class="hidden min-h-11 min-w-11 sm:inline-flex" />
            <NotificationBell />
            <UButton
                variant="ghost"
                :class="[profileIconColor, 'min-h-11 min-w-11']"
                href="/profile"
                :aria-label="userRef ? 'Open your profile' : 'Sign in'"
            >
                <template v-if="userRef">
                    <UserAvatar :user="user" size="sm" />
                </template>
                <template v-else>
                    <UIcon name="i-material-symbols-account-circle-full" class="text-xl" />
                    <span class="ml-2 text-sm font-medium">Sign in</span>
                </template>
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

type ActiveSeasonHeader = {
    is_voting_open?: boolean;
    is_gallery_public?: number | boolean | null;
    is_submission_closed?: number | boolean | null;
};

const { data: hackathon } = useApiFetch<ActiveSeasonHeader>("/api/seasons/active", {
    lazy: true,
    $fetch: globalThis.$fetch,
});

const profileIconColor = computed(() => {
    return userRef.value ? "text-primary" : "text-ui-muted";
});

const galleryPublic = computed(() =>
    Boolean(hackathon.value?.is_gallery_public || hackathon.value?.is_submission_closed),
);

const canVote = computed(() => {
    if (!hackathon.value?.is_voting_open) return false;
    if (!can(NethackPermissions.Judging.assignmentsRead)) {
        return Boolean(user.value?.team);
    }
    return false;
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
    if (galleryPublic.value) {
        links.push({
            label: "Projects",
            to: "/projects",
            icon: "i-lucide-layout-grid",
        });
    }
    if (canVote.value) {
        links.push({
            label: "Voting",
            to: "/voting",
            icon: "i-material-symbols-star-rate",
        });
    }
    // Judges keep the Judging link outside the voting phase so completed
    // evaluations stay reachable; the page itself handles the closed state.
    if (can(NethackPermissions.Judging.assignmentsRead)) {
        links.push({
            label: "Judging",
            to: "/judging",
            icon: "i-material-symbols-gavel",
        });
    }
    return links;
});
</script>
