<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";
import { formatDateTime } from "~/utils/datetime";

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Mod Portal | ${WEBSITE_NAME}`,
});

interface PreflightResponse {
    season_id?: number;
    submitted_teams?: number;
    teams_below_minimum_evaluations?: number;
    evaluations_total?: number;
    judges_with_evaluations?: number;
    assigned_judges?: number;
    mismatches?: Record<string, number | boolean>;
    vote_cap?: { max_votes_per_user: number; max_eligible_projects: number; feasible: boolean };
    gates?: Record<string, boolean>;
    // Earlier contract keys stay optional so either deployment shape renders.
    submitted_count?: number;
    teams_below_threshold?: number;
    judge_count?: number;
    timestamp_status_mismatches?: string[];
    vote_cap_feasible?: boolean;
    warnings?: string[];
}

const mismatchLabels: Record<string, string> = {
    finished_without_results: "The event is finished but results are not published.",
    published_without_timestamp: "Results are published without a publication timestamp.",
    missing_event_end: "The event end time is missing.",
    invalid_date_range: "A schedule range runs backwards.",
};

const toast = useToast();
const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));

const {
    data: adminData,
    error,
    refresh: refreshAdmin,
} = await useApiFetch("/api/admin/hackathon", {
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

const preflight = ref<PreflightResponse | null>(null);
const preflightError = ref<unknown>(null);
const preflightLoading = ref(false);

async function loadPreflight() {
    const season = activeSeason.value;
    if (!season || preflightLoading.value) return;
    preflightLoading.value = true;
    preflightError.value = null;
    try {
        preflight.value = await apiFetch<PreflightResponse>(
            `/api/admin/preflight?season_id=${season.id}`,
        );
    } catch (loadError) {
        preflight.value = null;
        preflightError.value = loadError;
    } finally {
        preflightLoading.value = false;
    }
}

watch(
    activeSeason,
    (season) => {
        if (season) void loadPreflight();
    },
    { immediate: true },
);

const publishing = ref(false);
const resultsPublished = computed(() => Boolean(hackathon.value?.results_published));

const preflightSubmitted = computed(
    () => preflight.value?.submitted_teams ?? preflight.value?.submitted_count ?? 0,
);
const preflightBelowMinimum = computed(
    () =>
        preflight.value?.teams_below_minimum_evaluations ??
        preflight.value?.teams_below_threshold ??
        0,
);
const preflightJudgeCount = computed(
    () => preflight.value?.judges_with_evaluations ?? preflight.value?.judge_count ?? 0,
);
const preflightVoteCapFeasible = computed(
    () => preflight.value?.vote_cap?.feasible ?? preflight.value?.vote_cap_feasible ?? false,
);
const preflightGates = computed(() => preflight.value?.gates ?? {});
const preflightMismatches = computed(() => {
    const messages = [...(preflight.value?.timestamp_status_mismatches ?? [])];
    for (const [key, count] of Object.entries(preflight.value?.mismatches ?? {})) {
        if (!count) continue;
        const suffix = typeof count === "number" && count > 1 ? ` (${count})` : "";
        messages.push(`${mismatchLabels[key] ?? key}${suffix}`);
    }
    return messages;
});
const preflightWarnings = computed(() => preflight.value?.warnings ?? []);

async function publishResults() {
    const season = activeSeason.value;
    if (!season || publishing.value || resultsPublished.value) return;
    if (
        !window.confirm(
            `Publish results for ${season.name}?\n\nThis closes judging and voting immediately and freezes the published scores and ranks. Teams will see the results page.`,
        )
    ) {
        return;
    }
    publishing.value = true;
    try {
        await apiFetch("/api/admin/hackathon", {
            method: "PATCH",
            body: {
                season_id: season.id,
                results_published: 1,
                judging_open: 0,
                voting_enabled: 0,
            },
        });
        await refreshAdmin();
        void loadPreflight();
        toast.add({
            title: "Results published",
            description: "Judging and voting are closed and the standings are frozen.",
            color: "success",
        });
    } catch (publishError) {
        toast.add({
            title: "Could not publish results",
            description: getErrorMessage(publishError),
            color: "error",
        });
    } finally {
        publishing.value = false;
    }
}

const exportingStandings = ref(false);

async function downloadStandingsCsv() {
    const season = activeSeason.value;
    if (!season || exportingStandings.value) return;
    exportingStandings.value = true;
    try {
        const blob = await apiFetch<Blob>(`/api/admin/standings.csv?season_id=${season.id}`, {
            responseType: "blob",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `standings-${season.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (downloadError) {
        toast.add({
            title: isEndpointUnavailable(downloadError)
                ? "Standings export is not enabled"
                : "Could not download standings",
            description: isEndpointUnavailable(downloadError)
                ? "This deployment does not expose the standings CSV endpoint yet."
                : getErrorMessage(downloadError),
            color: isEndpointUnavailable(downloadError) ? "warning" : "error",
        });
    } finally {
        exportingStandings.value = false;
    }
}

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
        label: "Awards",
        description: "Manage the award catalog and project assignments.",
        icon: "i-lucide-award",
        to: "/developers/awards",
    },
    {
        label: "Audit log",
        description: "Review administrative changes with before and after values.",
        icon: "i-lucide-scroll-text",
        to: "/developers/audit",
    },
    ...(import.meta.dev
        ? [
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
          ]
        : []),
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
            <UAlert
                v-if="!isAdmin"
                color="error"
                variant="subtle"
                icon="i-lucide-shield-x"
                title="Access denied"
                description="Administrator access is required for the mod portal."
                class="m-4 sm:m-6"
            />

            <div v-else class="p-4 sm:p-6 space-y-6">
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

                <UCard>
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 class="text-xl font-semibold">Event readiness</h2>
                                <p class="mt-1 text-sm text-ui-text-muted">
                                    Checks the active season before results are published.
                                </p>
                            </div>
                            <UButton
                                variant="outline"
                                icon="i-lucide-refresh-cw"
                                class="min-h-11"
                                :loading="preflightLoading"
                                :disabled="!activeSeason || preflightLoading"
                                @click="loadPreflight"
                            >
                                Recheck
                            </UButton>
                        </div>
                    </template>

                    <p v-if="preflightLoading" class="text-sm text-ui-text-muted" role="status">
                        Checking readiness…
                    </p>

                    <template v-else-if="preflight">
                        <dl class="grid gap-3 text-sm sm:grid-cols-3">
                            <div class="rounded-lg border border-default p-3">
                                <dt class="text-ui-text-muted">Submitted teams</dt>
                                <dd class="mt-1 text-2xl font-semibold tabular-nums">
                                    {{ preflightSubmitted }}
                                </dd>
                            </div>
                            <div class="rounded-lg border border-default p-3">
                                <dt class="text-ui-text-muted">Teams below 3 evaluations</dt>
                                <dd class="mt-1 text-2xl font-semibold tabular-nums">
                                    {{ preflightBelowMinimum }}
                                </dd>
                            </div>
                            <div class="rounded-lg border border-default p-3">
                                <dt class="text-ui-text-muted">Judges</dt>
                                <dd class="mt-1 text-2xl font-semibold tabular-nums">
                                    {{ preflightJudgeCount }}
                                    <span
                                        v-if="preflight.assigned_judges !== undefined"
                                        class="text-sm font-normal text-ui-text-muted"
                                    >
                                        evaluated · {{ preflight.assigned_judges }} assigned
                                    </span>
                                </dd>
                            </div>
                        </dl>

                        <div class="mt-4 flex flex-wrap items-center gap-2">
                            <UBadge
                                :color="preflightVoteCapFeasible ? 'success' : 'warning'"
                                variant="subtle"
                            >
                                Vote cap
                                {{ preflightVoteCapFeasible ? "feasible" : "needs attention" }}
                            </UBadge>
                            <UBadge
                                v-if="preflight.evaluations_total !== undefined"
                                color="neutral"
                                variant="subtle"
                            >
                                {{ preflight.evaluations_total }} evaluations
                            </UBadge>
                            <UBadge
                                v-for="[gate, open] in Object.entries(preflightGates)"
                                :key="gate"
                                :color="open ? 'success' : 'neutral'"
                                variant="subtle"
                            >
                                {{ gate }}: {{ open ? "open" : "closed" }}
                            </UBadge>
                        </div>

                        <ul
                            v-if="Object.keys(preflightGates).length === 0"
                            class="mt-4 text-sm text-ui-text-muted"
                        >
                            No publish gates were reported.
                        </ul>

                        <UAlert
                            v-if="preflightMismatches.length"
                            color="warning"
                            variant="subtle"
                            title="Schedule and status do not line up"
                            class="mt-4"
                        >
                            <template #description>
                                <ul class="list-disc space-y-1 ps-5">
                                    <li v-for="mismatch in preflightMismatches" :key="mismatch">
                                        {{ mismatch }}
                                    </li>
                                </ul>
                            </template>
                        </UAlert>

                        <UAlert
                            v-if="preflightWarnings.length"
                            color="warning"
                            variant="subtle"
                            title="Warnings"
                            class="mt-4"
                        >
                            <template #description>
                                <ul class="list-disc space-y-1 ps-5">
                                    <li v-for="warning in preflightWarnings" :key="warning">
                                        {{ warning }}
                                    </li>
                                </ul>
                            </template>
                        </UAlert>
                    </template>

                    <UAlert
                        v-else-if="isEndpointUnavailable(preflightError)"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-info"
                        title="Readiness check is not enabled"
                        description="This deployment does not expose the preflight endpoint yet. Every other action on this page still works."
                    />

                    <UAlert
                        v-else-if="preflightError"
                        color="error"
                        variant="subtle"
                        title="Could not load the readiness check"
                        :description="getErrorMessage(preflightError)"
                    >
                        <template #actions>
                            <UButton variant="outline" class="min-h-11" @click="loadPreflight">
                                Try again
                            </UButton>
                        </template>
                    </UAlert>

                    <p v-else class="text-sm text-ui-text-muted">
                        Select an active season to check readiness.
                    </p>

                    <div class="mt-4 flex flex-wrap gap-3">
                        <UButton
                            class="min-h-11"
                            color="warning"
                            :loading="publishing"
                            :disabled="!activeSeason || resultsPublished || publishing"
                            @click="publishResults"
                        >
                            {{ resultsPublished ? "Results published" : "Publish results" }}
                        </UButton>
                        <UButton
                            class="min-h-11"
                            variant="outline"
                            icon="i-lucide-download"
                            :loading="exportingStandings"
                            :disabled="!activeSeason || exportingStandings"
                            @click="downloadStandingsCsv"
                        >
                            Download standings CSV
                        </UButton>
                        <UButton class="min-h-11" variant="outline" to="/developers/audit">
                            Open audit log
                        </UButton>
                        <UButton class="min-h-11" variant="outline" to="/developers/awards">
                            Manage awards
                        </UButton>
                    </div>
                </UCard>

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
