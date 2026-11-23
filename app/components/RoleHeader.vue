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
            <UBadge
                v-if="eventBadge"
                :color="eventBadge.tone"
                variant="subtle"
                size="sm"
                class="hidden shrink-0 md:inline-flex"
            >
                {{ eventBadge.label }}
            </UBadge>
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
            <div class="mt-3 flex items-center gap-3 border-t border-default px-2.5 pt-3 sm:hidden">
                <UBadge v-if="eventBadge" :color="eventBadge.tone" variant="subtle" size="sm">
                    {{ eventBadge.label }}
                </UBadge>
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
    status?: string;
    is_voting_open?: boolean;
    voting_start_timestamp?: number;
    is_gallery_public?: number | boolean | null;
    is_submission_closed?: number | boolean | null;
    results_published?: number | boolean | null;
};

const { data: hackathon } = useApiFetch<ActiveSeasonHeader>("/api/seasons/active", {
    lazy: true,
});

const eventBadge = computed(() => {
    const status = hackathon.value?.status;
    if (!status) return null;
    if (status === "finished") return { label: "Ended", tone: "neutral" as const };
    if (status === "paused") return { label: "Paused", tone: "warning" as const };
    if (status === "voting") {
        if (hackathon.value?.is_voting_open) {
            return { label: "Voting open", tone: "primary" as const };
        }
        const start = Number(hackathon.value?.voting_start_timestamp ?? 0);
        if (start > 0 && start > Date.now()) {
            return { label: "Voting soon", tone: "primary" as const };
        }
        return { label: "Voting closed", tone: "neutral" as const };
    }
    if (status === "in_progress") {
        return hackathon.value?.is_submission_closed
            ? { label: "Submissions closed", tone: "warning" as const }
            : { label: "Live", tone: "primary" as const };
    }
    return { label: "Upcoming", tone: "neutral" as const };
});

const profileIconColor = computed(() => {
    return userRef.value ? "text-primary" : "text-ui-muted";
});

const galleryPublic = computed(() => Boolean(hackathon.value?.is_gallery_public));

const canVote = computed(() => {
    if (!hackathon.value?.is_voting_open) return false;
    if (!can(NethackPermissions.Judging.assignmentsRead)) {
        const team = user.value?.team;
        return Boolean(team?.project.submitted && team.status === "active");
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
