<script setup lang="ts">
import { formatDateTime } from "~/utils/datetime";

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Mod Portal | ${WEBSITE_NAME}`,
});

const { data: adminData, error } = await useApiFetch("/api/admin/hackathon", {
    server: false,
    $fetch: globalThis.$fetch,
});
if (error.value) throw error.value;

const hackathon = computed(() => adminData.value?.hackathon ?? null);
const activeSeason = computed(
    () => adminData.value?.seasons?.find((season: Season) => season.is_active === 1) ?? null,
);

const statusLabels: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    voting: "Voting",
    finished: "Finished",
    paused: "Paused",
};

const statusLabel = computed(
    () => statusLabels[hackathon.value?.status ?? "not_started"] ?? "Not started",
);

const toggles = computed(() => {
    const paused = hackathon.value?.status === "paused";
    const published = Boolean(hackathon.value?.results_published);
    return [
        { label: "Voting", value: !paused && Boolean(hackathon.value?.voting_enabled) },
        { label: "Judging", value: !paused && Boolean(hackathon.value?.judging_open) },
        { label: "Results published", value: published },
        // Scores and ranks stay hidden to participants until publication,
        // regardless of the individual visibility switches.
        { label: "Scores visible", value: published && Boolean(hackathon.value?.show_scores) },
        { label: "Ranking visible", value: published && Boolean(hackathon.value?.show_ranking) },
    ];
});

const links = [
    {
        label: "Hackathon",
        description: "Season, schedule, theme, toggles, rubric, and exports.",
        icon: "i-lucide-flag",
        to: "/developers/season",
    },
    {
        label: "Documentation",
        description: "Embedded operations and technical reference.",
        icon: "i-lucide-book-open",
        to: "/developers/docs",
    },
    {
        label: "Users",
        description: "Search accounts, promote administrators, and remove users.",
        icon: "i-lucide-user",
        to: "/developers/users",
    },
    {
        label: "Teams",
        description: "Review submissions, members, scores, and delete teams.",
        icon: "i-lucide-users",
        to: "/developers/teams",
    },
    {
        label: "Files",
        description: "Inspect uploaded assets and their permalink references.",
        icon: "i-lucide-files",
        to: "/developers/debug",
    },
    {
        label: "DeepSeek",
        description: "Chat sessions for the organizer assistant.",
        icon: "i-lucide-message-square",
        to: "/developers/deepseek",
    },
];

function formatTimestamp(ts: unknown): string {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return "Not set";
    return formatDateTime(num);
}
</script>

<template>
    <UDashboardPanel id="developers-home">
        <template #header>
            <UDashboardNavbar title="Mod Portal" :as="{ title: 'span' }">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="p-4 sm:p-6 space-y-6">
                <section class="bg-ui-bg p-6 rounded-lg space-y-3">
                    <div class="flex flex-wrap items-center gap-3">
                        <h1 class="text-2xl font-semibold">{{ WEBSITE_NAME }} mod portal</h1>
                        <UBadge color="neutral" variant="subtle">{{ statusLabel }}</UBadge>
                    </div>
                    <p class="text-sm text-ui-text-muted">
                        <template v-if="activeSeason">
                            Active season:
                            <span class="bold">{{ activeSeason.name }}</span>
                        </template>
                        <template v-else>No season is active. Set one in Hackathon.</template>
                    </p>
                    <p class="text-lg">{{ hackathon?.theme_name || "No theme set" }}</p>
                    <ul class="flex flex-wrap gap-2">
                        <li v-for="toggle in toggles" :key="toggle.label">
                            <UBadge :color="toggle.value ? 'success' : 'neutral'" variant="subtle">
                                {{ toggle.label }}: {{ toggle.value ? "on" : "off" }}
                            </UBadge>
                        </li>
                    </ul>
                    <p class="text-xs text-ui-text-muted">
                        Voting and judging are off while the event is paused. Scores and rankings
                        also require published results and at least three judge evaluations.
                    </p>
                    <dl class="grid gap-1 text-sm sm:grid-cols-3">
                        <div>
                            <dt class="text-ui-text-muted">Event</dt>
                            <dd>
                                {{ formatTimestamp(hackathon?.start_timestamp) }} —
                                {{ formatTimestamp(hackathon?.end_timestamp) }}
                            </dd>
                        </div>
                        <div>
                            <dt class="text-ui-text-muted">Voting</dt>
                            <dd>
                                {{ formatTimestamp(hackathon?.voting_start_timestamp) }} —
                                {{ formatTimestamp(hackathon?.voting_end_timestamp) }}
                            </dd>
                        </div>
                        <div>
                            <dt class="text-ui-text-muted">Results open</dt>
                            <dd>{{ formatTimestamp(hackathon?.results_open_timestamp) }}</dd>
                        </div>
                    </dl>
                </section>

                <section class="space-y-3">
                    <h2 class="text-xl font-semibold">Manage</h2>
                    <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <li v-for="link in links" :key="link.to">
                            <ULink :to="link.to" class="block h-full">
                                <UCard class="h-full">
                                    <div class="flex items-start gap-3">
                                        <UIcon :name="link.icon" class="size-6 shrink-0" />
                                        <div>
                                            <p class="font-semibold">{{ link.label }}</p>
                                            <p class="text-sm text-ui-text-muted">
                                                {{ link.description }}
                                            </p>
                                        </div>
                                    </div>
                                </UCard>
                            </ULink>
                        </li>
                    </ul>
                </section>
            </div>
        </template>
    </UDashboardPanel>
</template>
