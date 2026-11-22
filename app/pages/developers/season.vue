<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { onBeforeRouteLeave } from "vue-router";
import { NethackPermissions } from "~~/shared/permissions";
import { SCORE_CURVE_PRESETS, type ScoreCurvePreset } from "~~/shared/score-curve";
import { formatDateTime, fromDateTimeLocalString, toDateTimeLocalString } from "~/utils/datetime";
import AdminRubricManager from "~/components/admin/RubricManager.vue";

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `Seasons | ${WEBSITE_NAME}` });

const toast = useToast();
const { data: user, status: authStatus } = await useApiUser();
const { can } = useNethackPermissions();

if (authStatus.value !== "pending" && authStatus.value !== "idle") {
    if (!user.value || !can(NethackPermissions.all)) {
        throw createError({ statusCode: 403, statusMessage: "Access denied" });
    }
}

const {
    data: adminData,
    error: adminError,
    refresh: refreshAdmin,
    status: adminStatus,
} = await useApiFetch("/api/admin/hackathon", {
    lazy: true,
});

const seasons = computed<Season[]>(() => (adminData.value?.seasons ?? []) as Season[]);
const selectedSeasonId = ref<number | null>(null);
const selectedSeason = computed(
    () => seasons.value.find((season) => season.id === selectedSeasonId.value) ?? null,
);
const selectedSeasonIsActive = computed(() => selectedSeason.value?.is_active === 1);

const preflight = ref<AdminPreflightResponse | null>(null);
const preflightLoading = ref(false);

async function loadPreflight() {
    if (selectedSeasonId.value === null) {
        preflight.value = null;
        return;
    }
    preflightLoading.value = true;
    try {
        preflight.value = await apiFetch<AdminPreflightResponse>(
            `/api/admin/preflight?season_id=${selectedSeasonId.value}`,
        );
    } catch {
        preflight.value = null;
    } finally {
        preflightLoading.value = false;
    }
}

async function refreshAll() {
    await refreshAdmin();
    await loadPreflight();
}

watchEffect(() => {
    if (selectedSeasonId.value !== null || seasons.value.length === 0) return;
    const active = seasons.value.find((season) => season.is_active === 1);
    selectedSeasonId.value = active?.id ?? seasons.value.at(-1)?.id ?? null;
});

// ---------------------------------------------------------------------------
// Season settings
// ---------------------------------------------------------------------------
type SettingsForm = {
    start_timestamp: string;
    end_timestamp: string;
    voting_start_timestamp: string;
    voting_end_timestamp: string;
    results_open_timestamp: string;
    theme_name: string;
    theme_description: string;
    announcement: string;
    max_votes_per_user: number;
    show_scores: boolean;
    show_ranking: boolean;
};

const settings = reactive<SettingsForm>({
    start_timestamp: "",
    end_timestamp: "",
    voting_start_timestamp: "",
    voting_end_timestamp: "",
    results_open_timestamp: "",
    theme_name: "",
    theme_description: "",
    announcement: "",
    max_votes_per_user: 0,
    show_scores: false,
    show_ranking: false,
});
const settingsSnapshot = ref("");
const settingsSaving = ref(false);
const settingsReady = ref(false);

function timestampToInput(value: unknown): string {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? toDateTimeLocalString(number) : "";
}

function applySettings() {
    const season = selectedSeason.value;
    settingsReady.value = false;
    if (!season) {
        settingsSnapshot.value = "";
        return;
    }
    settings.start_timestamp = timestampToInput(season.start_timestamp);
    settings.end_timestamp = timestampToInput(season.end_timestamp);
    settings.voting_start_timestamp = timestampToInput(season.voting_start_timestamp);
    settings.voting_end_timestamp = timestampToInput(season.voting_end_timestamp);
    settings.results_open_timestamp = timestampToInput(season.results_open_timestamp);
    settings.theme_name = season.theme_name ?? "";
    settings.theme_description = season.theme_description ?? "";
    settings.announcement = season.announcement ?? "";
    settings.max_votes_per_user = Number(season.max_votes_per_user ?? 0);
    settings.show_scores = Number(season.show_scores ?? 0) === 1;
    settings.show_ranking = Number(season.show_ranking ?? 0) === 1;
    settingsSnapshot.value = JSON.stringify(settings);
    settingsReady.value = true;
}

function loadSettings() {
    applySettings();
}

watch(
    selectedSeasonId,
    () => {
        loadSettings();
    },
    { immediate: true },
);

watch(selectedSeasonId, () => {
    if (import.meta.client) void loadPreflight();
});

onMounted(() => {
    if (selectedSeasonId.value !== null) void loadPreflight();
});

const settingsDirty = computed(
    () => settingsReady.value && JSON.stringify(settings) !== settingsSnapshot.value,
);

const settingsErrors = computed<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    const start = fromDateTimeLocalString(settings.start_timestamp);
    const end = fromDateTimeLocalString(settings.end_timestamp);
    const votingStart = fromDateTimeLocalString(settings.voting_start_timestamp);
    const votingEnd = fromDateTimeLocalString(settings.voting_end_timestamp);
    const resultsOpen = fromDateTimeLocalString(settings.results_open_timestamp);
    if (start > 0 && end > 0 && end <= start) {
        errors.end_timestamp = "The event must end after it starts.";
    }
    if (votingStart > 0 && votingEnd > 0 && votingEnd <= votingStart) {
        errors.voting_end_timestamp = "Voting must end after voting starts.";
    }
    if (votingEnd > 0 && resultsOpen > 0 && resultsOpen < votingEnd) {
        errors.results_open_timestamp = "Results must open after voting closes.";
    }
    return errors;
});

const settingsValid = computed(() => Object.keys(settingsErrors.value).length === 0);

async function saveSettings() {
    const season = selectedSeason.value;
    if (!season || !settingsDirty.value || settingsSaving.value) return;
    if (!settingsValid.value) {
        toast.add({
            title: "Check the schedule order",
            description: Object.values(settingsErrors.value)[0],
            color: "warning",
        });
        return;
    }

    settingsSaving.value = true;
    try {
        await apiFetch("/api/admin/hackathon", {
            method: "PATCH",
            body: {
                season_id: season.id,
                start_timestamp: fromDateTimeLocalString(settings.start_timestamp),
                end_timestamp: fromDateTimeLocalString(settings.end_timestamp),
                voting_start_timestamp: fromDateTimeLocalString(settings.voting_start_timestamp),
                voting_end_timestamp: fromDateTimeLocalString(settings.voting_end_timestamp),
                results_open_timestamp: fromDateTimeLocalString(settings.results_open_timestamp),
                theme_name: settings.theme_name || null,
                theme_description: settings.theme_description || null,
                announcement: settings.announcement || null,
                max_votes_per_user: Math.max(0, Number(settings.max_votes_per_user) || 0),
                show_scores: settings.show_scores ? 1 : 0,
                show_ranking: settings.show_ranking ? 1 : 0,
            },
        });
        await refreshAll();
        settingsSnapshot.value = JSON.stringify(settings);
        toast.add({ title: "Season settings saved.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not save season settings",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        settingsSaving.value = false;
    }
}

function discardSettings() {
    applySettings();
}

const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!settingsDirty.value) return;
    event.preventDefault();
    event.returnValue = "";
};

onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeUnload));
onBeforeRouteLeave(() => {
    if (!settingsDirty.value) return true;
    return window.confirm("Discard the unsaved season settings?");
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const stageLabels: Record<string, string> = {
    not_started: "Setup",
    in_progress: "Submissions open",
    voting: "Voting and judging",
    finished: "Finished",
    paused: "Paused",
};

const stageSteps = computed(() => [
    {
        label: "Setup",
        description: "Dates, theme, and rubric",
        done: ["in_progress", "voting", "finished"].includes(
            selectedSeason.value?.status ?? "not_started",
        ),
        current: (selectedSeason.value?.status ?? "not_started") === "not_started",
    },
    {
        label: "Submissions",
        description: "Teams build and submit projects",
        done: ["voting", "finished"].includes(selectedSeason.value?.status ?? ""),
        current: selectedSeason.value?.status === "in_progress",
    },
    {
        label: "Voting and judging",
        description: "Peer voting and judge scoring",
        done: selectedSeason.value?.status === "finished",
        current: selectedSeason.value?.status === "voting",
    },
    {
        label: "Results",
        description: "Publish standings and awards",
        done: Number(selectedSeason.value?.results_published ?? 0) === 1,
        current:
            selectedSeason.value?.status === "finished" &&
            Number(selectedSeason.value?.results_published ?? 0) !== 1,
    },
]);

const activationBlockers = computed(() => {
    const season = selectedSeason.value;
    if (!season) return ["Select a season."];
    const blockers: string[] = [];
    if (!season.start_timestamp || !season.end_timestamp) blockers.push("Set the event dates.");
    if (!season.theme_name) blockers.push("Set the theme.");
    if (!season.rubric_version_id) blockers.push("Publish a judging rubric.");
    if (season.is_blank_start === 1 && !season.board_approved_at) {
        blockers.push("Record board approval.");
    }
    return blockers;
});

const canActivate = computed(
    () =>
        Boolean(selectedSeason.value) &&
        !selectedSeasonIsActive.value &&
        activationBlockers.value.length === 0,
);

const published = computed(() => Number(selectedSeason.value?.results_published ?? 0) === 1);
const paused = computed(() => selectedSeason.value?.status === "paused");

const nextAction = computed(() => {
    const season = selectedSeason.value;
    if (!season) return null;
    if (!selectedSeasonIsActive.value) {
        return {
            key: "activate",
            label: "Make this season live",
            description: canActivate.value
                ? "Switch the public site to this season. Its settings apply immediately."
                : `Finish the setup checklist first: ${activationBlockers.value.join(" ")}`,
            enabled: canActivate.value,
            confirm: "Make this season the live season? The public site switches immediately.",
        };
    }
    if (paused.value) {
        return {
            key: "resume",
            label: "Resume the event",
            description: "Restore submissions, voting, or judging based on the saved dates.",
            enabled: true,
            confirm: "Resume the event?",
        };
    }
    if (season.status === "finished") {
        return published.value
            ? null
            : {
                  key: "publish",
                  label: "Publish results",
                  description: "Close judging and voting, then publish the standings and awards.",
                  enabled: true,
                  confirm:
                      "Publish results? This closes judging and voting and makes the standings public.",
              };
    }
    if (published.value) {
        return {
            key: "finish",
            label: "Finish the event",
            description: "Mark the season finished. Results stay public.",
            enabled: true,
            confirm: "Finish the event? Results stay public.",
        };
    }
    if (season.status === "voting") {
        return {
            key: "publish",
            label: "Publish results",
            description: "Close judging and voting, then publish the standings and awards.",
            enabled: true,
            confirm:
                "Publish results? This closes judging and voting and makes the standings public.",
        };
    }
    if (season.status === "not_started") {
        const ready = activationBlockers.value.length === 0;
        return {
            key: "submissions",
            label: "Open submissions",
            description: ready
                ? "Start accepting teams and projects."
                : `Finish setup first: ${activationBlockers.value.join(" ")}`,
            enabled: ready,
            confirm: "Open submissions for this season?",
        };
    }
    const readyForVoting = activationBlockers.value.length === 0;
    return {
        key: "voting",
        label: "Open peer voting and judging",
        description: readyForVoting
            ? "Close submissions, open the gallery, and let participants vote and judges score."
            : `Finish setup first: ${activationBlockers.value.join(" ")}`,
        enabled: readyForVoting,
        confirm:
            "Close submissions and open peer voting and judging? Teams can no longer edit their projects.",
    };
});

const lifecycleBusy = ref(false);

const resetItems = computed(() => {
    const season = selectedSeason.value;
    const status = season?.status ?? "not_started";
    return [
        {
            label: "Reopen submissions",
            icon: "i-lucide-undo-2",
            disabled: !season || status === "not_started",
            onSelect: () =>
                void runLifecycle(
                    "reopen-submissions",
                    "Reopen submissions? The event returns to the in-progress stage. Teams, projects, and scores are kept.",
                ),
        },
        {
            label: "Reopen voting and judging",
            icon: "i-lucide-rotate-ccw",
            disabled: !season || (!["voting", "finished"].includes(status) && !published.value),
            onSelect: () =>
                void runLifecycle(
                    "reopen-voting",
                    "Reopen voting and judging? Published results become private and the event returns to the voting stage. Teams, projects, and scores are kept.",
                ),
        },
        {
            label: "Unpublish results",
            icon: "i-lucide-eye-off",
            disabled: !published.value,
            onSelect: () =>
                void runLifecycle(
                    "unpublish",
                    "Unpublish results? The public results, scores, and rankings become private. The stored snapshot is cleared when you publish again. Teams, projects, and scores are kept.",
                ),
        },
        {
            label: "Reset to setup",
            icon: "i-lucide-refresh-ccw",
            disabled: !season || (status === "not_started" && !published.value),
            onSelect: () =>
                void runLifecycle(
                    "reset-setup",
                    "Reset the event stage to setup? Submissions, voting, judging, and published results close. Teams, projects, and scores are kept.",
                ),
        },
    ];
});

async function runLifecycle(action: string, confirmation: string) {
    const season = selectedSeason.value;
    if (!season || lifecycleBusy.value) return;
    if (!window.confirm(confirmation)) return;

    if (action === "activate") {
        lifecycleBusy.value = true;
        try {
            await apiFetch("/api/seasons/active", {
                method: "PATCH",
                body: { season_id: season.id },
            });
            await refreshAll();
            toast.add({ title: "This season is now live.", color: "success" });
        } catch (error) {
            toast.add({
                title: "Could not activate the season",
                description: getErrorMessage(error),
                color: "error",
            });
        } finally {
            lifecycleBusy.value = false;
        }
        return;
    }

    const payload: Record<string, unknown> = { season_id: season.id };
    if (action === "resume") {
        const now = Date.now();
        payload.status =
            now >= Number(season.voting_start_timestamp) &&
            Number(season.voting_start_timestamp) > 0
                ? "voting"
                : "in_progress";
        payload.voting_enabled = payload.status === "voting" ? 1 : 0;
        payload.judging_open = payload.status === "voting" ? 1 : 0;
    } else if (action === "submissions") {
        payload.status = "in_progress";
        payload.voting_enabled = 0;
        payload.judging_open = 0;
        payload.results_published = 0;
        payload.show_scores = 0;
        payload.show_ranking = 0;
    } else if (action === "voting") {
        payload.status = "voting";
        payload.voting_enabled = 1;
        payload.judging_open = 1;
        payload.results_published = 0;
    } else if (action === "publish") {
        payload.results_published = 1;
        payload.show_scores = 1;
        payload.show_ranking = 1;
        payload.voting_enabled = 0;
        payload.judging_open = 0;
    } else if (action === "finish") {
        payload.status = "finished";
        payload.voting_enabled = 0;
        payload.judging_open = 0;
    } else if (action === "pause") {
        payload.status = "paused";
        payload.voting_enabled = 0;
        payload.judging_open = 0;
    } else if (action === "reopen-submissions") {
        payload.status = "in_progress";
        payload.voting_enabled = 0;
        payload.judging_open = 0;
        payload.results_published = 0;
        payload.show_scores = 0;
        payload.show_ranking = 0;
    } else if (action === "reopen-voting") {
        payload.status = "voting";
        payload.voting_enabled = 1;
        payload.judging_open = 1;
        payload.results_published = 0;
        payload.show_scores = 0;
        payload.show_ranking = 0;
    } else if (action === "unpublish") {
        payload.results_published = 0;
        payload.show_scores = 0;
        payload.show_ranking = 0;
        payload.voting_enabled = 0;
        payload.judging_open = 0;
    } else if (action === "reset-setup") {
        payload.status = "not_started";
        payload.voting_enabled = 0;
        payload.judging_open = 0;
        payload.results_published = 0;
        payload.show_scores = 0;
        payload.show_ranking = 0;
    } else {
        return;
    }

    lifecycleBusy.value = true;
    try {
        await apiFetch("/api/admin/hackathon", { method: "PATCH", body: payload });
        await refreshAll();
        toast.add({ title: "Season updated.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not update the season",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        lifecycleBusy.value = false;
    }
}

// ---------------------------------------------------------------------------
// Season management
// ---------------------------------------------------------------------------
const activeTab = ref("run");
const tabItems = [
    { label: "Run season", value: "run", icon: "i-lucide-play" },
    { label: "Season settings", value: "settings", icon: "i-lucide-sliders-horizontal" },
    { label: "Seasons", value: "seasons", icon: "i-lucide-calendar-range" },
    { label: "Rubric", value: "rubric", icon: "i-lucide-trophy" },
    { label: "Site and data", value: "site", icon: "i-lucide-building-2" },
];

const newSeasonName = ref("");
const copySettings = ref(true);
const creatingSeason = ref(false);

async function createSeason() {
    const name = newSeasonName.value.trim();
    if (!name || creatingSeason.value) return;
    creatingSeason.value = true;
    try {
        const result = await apiFetch<{ seasons: Season[] }>("/api/admin/seasons", {
            method: "POST",
            body: { name, copy_live_settings: copySettings.value },
        });
        await refreshAdmin();
        selectedSeasonId.value = result.seasons.find((season) => season.name === name)?.id ?? null;
        newSeasonName.value = "";
        toast.add({ title: `Season “${name}” created.`, color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not create the season",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        creatingSeason.value = false;
    }
}

const seasonNameDraft = ref("");
const renamingSeason = ref(false);

watch(
    selectedSeason,
    (season) => {
        seasonNameDraft.value = season?.name ?? "";
    },
    { immediate: true },
);

async function renameSeason() {
    const season = selectedSeason.value;
    const name = seasonNameDraft.value.trim();
    if (!season || !name || name === season.name || renamingSeason.value) return;
    renamingSeason.value = true;
    try {
        await apiFetch("/api/admin/seasons", {
            method: "PATCH",
            body: { id: season.id, name },
        });
        await refreshAdmin();
        toast.add({ title: "Season renamed.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not rename the season",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        renamingSeason.value = false;
    }
}

const deletingSeason = ref(false);

async function deleteSeason() {
    const season = selectedSeason.value;
    if (!season || season.is_active === 1 || deletingSeason.value) return;
    if (!window.confirm(`Delete “${season.name}”? This cannot be undone.`)) return;
    deletingSeason.value = true;
    try {
        const result = await apiFetch<{ seasons: Season[] }>(`/api/admin/seasons/${season.id}`, {
            method: "DELETE",
        });
        await refreshAdmin();
        selectedSeasonId.value = result.seasons.at(-1)?.id ?? null;
        toast.add({ title: "Season deleted.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not delete the season",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        deletingSeason.value = false;
    }
}

const teamLimit = ref(6);

watch(
    selectedSeason,
    (season) => {
        teamLimit.value = Number(season?.max_team_members ?? 6);
    },
    { immediate: true },
);

async function saveTeamLimit() {
    const season = selectedSeason.value;
    if (!season) return;
    try {
        await apiFetch("/api/admin/seasons", {
            method: "PATCH",
            body: { id: season.id, max_team_members: Math.max(1, Number(teamLimit.value) || 6) },
        });
        await refreshAdmin();
        toast.add({ title: "Team limit saved.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not save the team limit",
            description: getErrorMessage(error),
            color: "error",
        });
    }
}

const approvalSaving = ref(false);

async function setBoardApproval(approved: boolean) {
    const season = selectedSeason.value;
    if (!season || season.is_blank_start !== 1 || approvalSaving.value) return;
    if (
        !window.confirm(
            approved
                ? `Record board approval for “${season.name}”? Your account and the current time are saved.`
                : `Revoke board approval for “${season.name}”?`,
        )
    ) {
        return;
    }
    approvalSaving.value = true;
    try {
        await apiFetch(`/api/admin/seasons/${season.id}/approval`, {
            method: "PATCH",
            body: { approved },
        });
        await refreshAdmin();
        toast.add({
            title: approved ? "Board approval recorded." : "Board approval revoked.",
            color: "success",
        });
    } catch (error) {
        toast.add({
            title: "Could not update board approval",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        approvalSaving.value = false;
    }
}

// ---------------------------------------------------------------------------
// Rubric, score curve, and export
// ---------------------------------------------------------------------------
const scoreCurvePreset = ref<ScoreCurvePreset>("original");
const scoreCurveSaving = ref(false);
const scoreCurveItems = Object.entries(SCORE_CURVE_PRESETS).map(([value, preset]) => ({
    label: preset.label,
    value,
}));

watch(
    selectedSeason,
    (season) => {
        const preset = season?.score_curve_preset;
        scoreCurvePreset.value =
            preset && preset in SCORE_CURVE_PRESETS ? (preset as ScoreCurvePreset) : "original";
    },
    { immediate: true },
);

async function saveScoreCurvePreset(value: ScoreCurvePreset) {
    const season = selectedSeason.value;
    if (!season || scoreCurveSaving.value) return;
    const previous = scoreCurvePreset.value;
    scoreCurveSaving.value = true;
    try {
        await apiFetch(`/api/admin/seasons/${season.id}/score-curve`, {
            method: "PATCH",
            body: { preset: value },
        });
        await refreshAdmin();
        toast.add({ title: "Score curve saved.", color: "success" });
    } catch (error) {
        scoreCurvePreset.value = previous;
        toast.add({
            title: "Could not save the score curve",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        scoreCurveSaving.value = false;
    }
}

const databaseExporting = ref(false);

async function downloadDatabase(format: "json" | "csv") {
    if (databaseExporting.value) return;
    databaseExporting.value = true;
    try {
        const response = await fetch(`/api/admin/database/export?format=${format}`);
        if (!response.ok) throw new Error("Export failed.");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `nethack-export.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
        toast.add({
            title: "Could not export the database",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        databaseExporting.value = false;
    }
}
</script>

<template>
    <div class="space-y-8">
        <header class="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p class="text-sm text-muted">Hackathon operations</p>
                <h1 class="mt-1 text-3xl font-bold">Seasons</h1>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
                    A season owns its dates, theme, status, voting and judging switches, results,
                    and rubric. Only the live season is visible to visitors. Site-wide settings such
                    as the award catalog are managed separately.
                </p>
            </div>
            <div class="flex flex-wrap gap-2">
                <UButton to="/" target="_blank" variant="subtle" class="min-h-11">
                    View public site
                </UButton>
                <UButton
                    variant="outline"
                    class="min-h-11"
                    :loading="adminStatus === 'pending'"
                    @click="refreshAll"
                >
                    Refresh
                </UButton>
            </div>
        </header>

        <UAlert
            v-if="adminError"
            color="error"
            variant="subtle"
            title="Could not load the admin data"
            :description="getErrorMessage(adminError)"
        />

        <div class="flex flex-wrap items-center gap-3">
            <UFormField label="Season" class="min-w-64">
                <USelect
                    :model-value="selectedSeasonId ?? undefined"
                    :items="
                        seasons.map((season) => ({
                            label: `${season.name}${season.is_active === 1 ? ' (live)' : ''}`,
                            value: season.id,
                        }))
                    "
                    :ui="{ base: 'min-h-11' }"
                    class="w-full"
                    @update:model-value="(value) => (selectedSeasonId = Number(value))"
                />
            </UFormField>
            <UBadge v-if="selectedSeasonIsActive" color="success" variant="subtle">Live</UBadge>
            <UBadge v-else-if="selectedSeason" color="neutral" variant="subtle">Stored</UBadge>
            <span v-if="selectedSeason" class="text-sm text-muted">
                {{ stageLabels[selectedSeason.status] ?? selectedSeason.status }}
            </span>
        </div>

        <UTabs
            v-model="activeTab"
            :items="tabItems"
            :content="false"
            :ui="{ list: 'w-full overflow-x-auto' }"
        />

        <!-- Run season -->
        <section v-show="activeTab === 'run'" class="space-y-6">
            <UCard v-if="selectedSeason">
                <template #header>
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 class="text-xl font-semibold">{{ selectedSeason.name }}</h2>
                            <p class="text-sm text-muted">
                                {{ stageLabels[selectedSeason.status] ?? selectedSeason.status }}
                                <template v-if="selectedSeason.start_timestamp">
                                    · {{ formatDateTime(selectedSeason.start_timestamp) }}
                                </template>
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                v-if="nextAction"
                                class="min-h-11"
                                :disabled="!nextAction.enabled || lifecycleBusy"
                                :loading="lifecycleBusy"
                                @click="runLifecycle(nextAction.key, nextAction.confirm)"
                            >
                                {{ nextAction.label }}
                            </UButton>
                            <UDropdownMenu :items="resetItems">
                                <UButton variant="outline" class="min-h-11">Reset stage</UButton>
                            </UDropdownMenu>
                            <UButton
                                v-if="
                                    selectedSeasonIsActive &&
                                    !paused &&
                                    selectedSeason.status !== 'finished'
                                "
                                variant="subtle"
                                class="min-h-11"
                                @click="
                                    runLifecycle(
                                        'pause',
                                        'Pause the event? Submissions, voting, and judging stop.',
                                    )
                                "
                            >
                                Pause
                            </UButton>
                        </div>
                    </div>
                </template>
                <p v-if="nextAction" class="text-sm leading-6 text-muted">
                    {{ nextAction.description }}
                </p>
                <p v-else class="text-sm leading-6 text-muted">
                    The event is complete. Results and awards remain available in the public
                    archive.
                </p>
            </UCard>

            <UAlert
                v-if="selectedSeason && !selectedSeasonIsActive"
                color="warning"
                variant="subtle"
                title="This season is not live"
                :description="
                    canActivate
                        ? 'Use “Make this season live” to switch the public site to these settings.'
                        : `Before activation: ${activationBlockers.join(' ')}`
                "
            />

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <div
                    v-for="(step, index) in stageSteps"
                    :key="step.label"
                    class="border p-4"
                    :class="
                        step.current
                            ? 'border-primary bg-primary/5'
                            : step.done
                              ? 'border-default bg-elevated/40'
                              : 'border-default'
                    "
                >
                    <p class="text-xs text-muted">Step {{ index + 1 }}</p>
                    <p class="mt-1 font-semibold">{{ step.label }}</p>
                    <p class="mt-1 text-sm text-muted">{{ step.description }}</p>
                </div>
            </div>

            <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <UCard>
                    <template #header>
                        <h2 class="text-lg font-semibold">Readiness</h2>
                    </template>
                    <ul class="space-y-3 text-sm">
                        <li class="flex items-start justify-between gap-3">
                            <span>Event dates</span>
                            <span
                                :class="
                                    selectedSeason?.start_timestamp &&
                                    selectedSeason?.end_timestamp &&
                                    selectedSeason.end_timestamp > selectedSeason.start_timestamp
                                        ? 'text-success'
                                        : 'text-muted'
                                "
                            >
                                {{
                                    selectedSeason?.start_timestamp &&
                                    selectedSeason?.end_timestamp &&
                                    selectedSeason.end_timestamp > selectedSeason.start_timestamp
                                        ? "Ready"
                                        : "Missing"
                                }}
                            </span>
                        </li>
                        <li class="flex items-start justify-between gap-3">
                            <span>Theme</span>
                            <span
                                :class="selectedSeason?.theme_name ? 'text-success' : 'text-muted'"
                            >
                                {{ selectedSeason?.theme_name ? "Ready" : "Missing" }}
                            </span>
                        </li>
                        <li class="flex items-start justify-between gap-3">
                            <span>Judging rubric</span>
                            <span
                                :class="
                                    selectedSeason?.rubric_version_id
                                        ? 'text-success'
                                        : 'text-muted'
                                "
                            >
                                {{ selectedSeason?.rubric_version_id ? "Ready" : "Missing" }}
                            </span>
                        </li>
                        <li
                            v-if="selectedSeason?.is_blank_start === 1"
                            class="flex items-start justify-between gap-3"
                        >
                            <span>Board approval</span>
                            <span
                                :class="
                                    selectedSeason?.board_approved_at
                                        ? 'text-success'
                                        : 'text-muted'
                                "
                            >
                                {{ selectedSeason?.board_approved_at ? "Recorded" : "Missing" }}
                            </span>
                        </li>
                    </ul>
                </UCard>

                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between gap-3">
                            <h2 class="text-lg font-semibold">Event status</h2>
                            <span v-if="preflightLoading" class="text-xs text-muted">Loading…</span>
                        </div>
                    </template>
                    <dl v-if="preflight" class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <dt class="text-muted">Submitted teams</dt>
                            <dd class="mt-1 text-2xl font-semibold">
                                {{ preflight.submitted_teams }}
                            </dd>
                        </div>
                        <div>
                            <dt class="text-muted">Evaluations</dt>
                            <dd class="mt-1 text-2xl font-semibold">
                                {{ preflight.evaluations_total }}
                            </dd>
                        </div>
                        <div>
                            <dt class="text-muted">Judges with scores</dt>
                            <dd class="mt-1 text-2xl font-semibold">
                                {{ preflight.judges_with_evaluations }}
                            </dd>
                        </div>
                        <div>
                            <dt class="text-muted">Assigned judges</dt>
                            <dd class="mt-1 text-2xl font-semibold">
                                {{ preflight.assigned_judges }}
                            </dd>
                        </div>
                    </dl>
                    <p v-else class="text-sm text-muted">No status data for this season yet.</p>
                </UCard>
            </div>
        </section>

        <!-- Season settings -->
        <section v-show="activeTab === 'settings'" class="space-y-6">
            <UCard v-if="selectedSeason">
                <template #header>
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 class="text-xl font-semibold">Season settings</h2>
                            <p class="mt-1 text-sm text-muted">
                                Every field here belongs to {{ selectedSeason.name }}. Saving
                                applies the changes immediately when this season is live.
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <UButton
                                class="min-h-11"
                                :disabled="!settingsDirty || settingsSaving"
                                :loading="settingsSaving"
                                @click="saveSettings"
                            >
                                Save changes
                            </UButton>
                            <UButton
                                variant="subtle"
                                class="min-h-11"
                                :disabled="!settingsDirty || settingsSaving"
                                @click="discardSettings"
                            >
                                Discard
                            </UButton>
                        </div>
                    </div>
                </template>

                <div class="space-y-8">
                    <section>
                        <h3 class="text-lg font-semibold">Schedule</h3>
                        <p class="mt-1 text-sm text-muted">
                            Times are shown in Asia/Shanghai (UTC+8).
                        </p>
                        <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                            <UFormField
                                label="Event starts"
                                :error="settingsErrors.start_timestamp"
                            >
                                <UInput
                                    v-model="settings.start_timestamp"
                                    type="datetime-local"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Event ends" :error="settingsErrors.end_timestamp">
                                <UInput
                                    v-model="settings.end_timestamp"
                                    type="datetime-local"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Voting starts"
                                :error="settingsErrors.voting_start_timestamp"
                            >
                                <UInput
                                    v-model="settings.voting_start_timestamp"
                                    type="datetime-local"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Voting ends"
                                :error="settingsErrors.voting_end_timestamp"
                            >
                                <UInput
                                    v-model="settings.voting_end_timestamp"
                                    type="datetime-local"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Results released"
                                :error="settingsErrors.results_open_timestamp"
                            >
                                <UInput
                                    v-model="settings.results_open_timestamp"
                                    type="datetime-local"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Maximum stars per voter">
                                <UInput
                                    v-model.number="settings.max_votes_per_user"
                                    type="number"
                                    min="0"
                                    max="100"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                                <p class="mt-1 text-xs text-muted">
                                    Use 0 for no cap. Each ballot always distributes exactly 10
                                    stars.
                                </p>
                            </UFormField>
                        </div>
                    </section>

                    <section>
                        <h3 class="text-lg font-semibold">Theme and announcement</h3>
                        <div class="mt-4 space-y-4">
                            <UFormField label="Theme name">
                                <UInput
                                    v-model="settings.theme_name"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Theme description">
                                <UTextarea
                                    v-model="settings.theme_description"
                                    :rows="3"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Announcement"
                                help="Shown in the schedule section on the home page. Leave empty to hide it."
                            >
                                <UTextarea
                                    v-model="settings.announcement"
                                    :rows="3"
                                    :maxlength="2000"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                    </section>

                    <section>
                        <h3 class="text-lg font-semibold">Results visibility</h3>
                        <p class="mt-1 text-sm text-muted">
                            Scores and rankings stay hidden until results are published and at least
                            three judges have evaluated a team.
                        </p>
                        <div class="mt-4 space-y-3">
                            <UCheckbox
                                v-model="settings.show_scores"
                                label="Show scores to participants"
                            />
                            <UCheckbox
                                v-model="settings.show_ranking"
                                label="Show rankings publicly"
                            />
                        </div>
                    </section>
                </div>
            </UCard>
        </section>

        <!-- Seasons -->
        <section v-show="activeTab === 'seasons'" class="space-y-6">
            <UCard>
                <template #header>
                    <h2 class="text-xl font-semibold">All seasons</h2>
                </template>
                <div class="divide-y divide-default">
                    <div
                        v-for="season in seasons"
                        :key="season.id"
                        class="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <p class="truncate font-semibold">{{ season.name }}</p>
                                <UBadge
                                    v-if="season.is_active === 1"
                                    color="success"
                                    variant="subtle"
                                >
                                    Live
                                </UBadge>
                                <UBadge color="neutral" variant="subtle">
                                    {{ stageLabels[season.status] ?? season.status }}
                                </UBadge>
                            </div>
                            <p class="mt-1 text-sm text-muted">
                                {{
                                    season.start_timestamp
                                        ? formatDateTime(season.start_timestamp)
                                        : "No start"
                                }}
                                –
                                {{
                                    season.end_timestamp
                                        ? formatDateTime(season.end_timestamp)
                                        : "No end"
                                }}
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                variant="subtle"
                                class="min-h-11"
                                @click="selectedSeasonId = season.id"
                            >
                                Open
                            </UButton>
                            <UButton
                                v-if="season.is_active !== 1"
                                variant="outline"
                                class="min-h-11"
                                :disabled="
                                    !season.start_timestamp ||
                                    !season.end_timestamp ||
                                    !season.theme_name ||
                                    !season.rubric_version_id ||
                                    (season.is_blank_start === 1 && !season.board_approved_at)
                                "
                                @click="
                                    selectedSeasonId = season.id;
                                    runLifecycle(
                                        'activate',
                                        'Make this season the live season? The public site switches immediately.',
                                    );
                                "
                            >
                                Make live
                            </UButton>
                        </div>
                    </div>
                </div>
            </UCard>

            <UCard>
                <template #header>
                    <h2 class="text-xl font-semibold">Create a season</h2>
                </template>
                <form class="flex flex-wrap items-end gap-3" @submit.prevent="createSeason">
                    <UFormField label="Season name" class="min-w-64 flex-1">
                        <UInput
                            v-model="newSeasonName"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                            placeholder="For example, Season 2"
                        />
                    </UFormField>
                    <UCheckbox
                        v-model="copySettings"
                        label="Copy the live schedule, theme, and rubric"
                    />
                    <UButton
                        type="submit"
                        class="min-h-11"
                        :loading="creatingSeason"
                        :disabled="!newSeasonName.trim()"
                    >
                        Create season
                    </UButton>
                </form>
            </UCard>

            <UCard v-if="selectedSeason">
                <template #header>
                    <h2 class="text-xl font-semibold">{{ selectedSeason.name }} details</h2>
                </template>
                <div class="space-y-6">
                    <div class="flex flex-wrap items-end gap-3">
                        <UFormField label="Season name" class="min-w-64 flex-1">
                            <UInput
                                v-model="seasonNameDraft"
                                :ui="{ base: 'min-h-11' }"
                                class="w-full"
                            />
                        </UFormField>
                        <UButton
                            class="min-h-11"
                            :loading="renamingSeason"
                            :disabled="
                                !seasonNameDraft.trim() ||
                                seasonNameDraft.trim() === selectedSeason.name
                            "
                            @click="renameSeason"
                        >
                            Rename
                        </UButton>
                    </div>

                    <div>
                        <h3 class="font-semibold">Team limit</h3>
                        <p class="mt-1 text-sm text-muted">
                            Maximum roster size for teams in this season.
                        </p>
                        <div class="mt-3 flex flex-wrap items-end gap-3">
                            <UInput
                                v-model.number="teamLimit"
                                type="number"
                                min="1"
                                max="20"
                                :ui="{ base: 'min-h-11' }"
                                class="w-32"
                            />
                            <UButton class="min-h-11" @click="saveTeamLimit">Save limit</UButton>
                        </div>
                    </div>

                    <div v-if="selectedSeason.is_blank_start === 1">
                        <h3 class="font-semibold">Board approval</h3>
                        <p class="mt-1 text-sm text-muted">
                            A blank-start season needs recorded board approval before it can go
                            live.
                        </p>
                        <div class="mt-3 flex flex-wrap items-center gap-3">
                            <UButton
                                v-if="!selectedSeason.board_approved_at"
                                class="min-h-11"
                                :loading="approvalSaving"
                                @click="setBoardApproval(true)"
                            >
                                Record approval
                            </UButton>
                            <UButton
                                v-else
                                variant="outline"
                                class="min-h-11"
                                :loading="approvalSaving"
                                :disabled="selectedSeasonIsActive"
                                @click="setBoardApproval(false)"
                            >
                                Revoke approval
                            </UButton>
                            <span
                                v-if="selectedSeason.board_approved_at"
                                class="text-sm text-muted"
                            >
                                Recorded {{ formatDateTime(selectedSeason.board_approved_at) }}
                            </span>
                        </div>
                    </div>

                    <div v-if="selectedSeason.is_active !== 1" class="border-t border-default pt-4">
                        <UButton
                            color="error"
                            variant="subtle"
                            class="min-h-11"
                            :loading="deletingSeason"
                            @click="deleteSeason"
                        >
                            Delete season
                        </UButton>
                    </div>
                </div>
            </UCard>
        </section>

        <!-- Rubric -->
        <section v-show="activeTab === 'rubric'" class="space-y-6">
            <UCard v-if="selectedSeasonId !== null">
                <template #header>
                    <h2 class="text-xl font-semibold">Score display curve</h2>
                </template>
                <p class="max-w-3xl text-sm text-muted">
                    This changes the displayed score only. The original judge average stays saved,
                    and published ranking always uses that original score.
                </p>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                    <UFormField label="Display curve" class="w-full max-w-xs">
                        <USelect
                            v-model="scoreCurvePreset"
                            :items="scoreCurveItems"
                            :disabled="scoreCurveSaving"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                            @update:model-value="
                                (value) => saveScoreCurvePreset(value as ScoreCurvePreset)
                            "
                        />
                    </UFormField>
                    <span v-if="scoreCurveSaving" class="text-sm text-muted">Saving…</span>
                </div>
            </UCard>

            <AdminRubricManager
                v-if="selectedSeasonId !== null"
                :key="selectedSeasonId"
                :season-id="selectedSeasonId"
                :seasons="seasons"
            />
        </section>

        <!-- Site and data -->
        <section v-show="activeTab === 'site'" class="space-y-6">
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <UCard>
                    <template #header>
                        <h2 class="text-xl font-semibold">Site-wide awards</h2>
                    </template>
                    <p class="text-sm leading-6 text-muted">
                        The award catalog is independent of seasons. Names, icons, and colors
                        defined here are available to every season, while the award assignments
                        themselves belong to a team.
                    </p>
                    <UButton to="/developers/awards" class="mt-4 min-h-11">
                        Manage award catalog
                    </UButton>
                </UCard>

                <UCard>
                    <template #header>
                        <h2 class="text-xl font-semibold">Database export</h2>
                    </template>
                    <p class="text-sm leading-6 text-muted">
                        Download a full snapshot of the database. Judge identities, invitation
                        tokens, and OAuth client secrets are withheld.
                    </p>
                    <div class="mt-4 flex flex-wrap gap-3">
                        <UButton
                            class="min-h-11"
                            :loading="databaseExporting"
                            :disabled="databaseExporting"
                            @click="downloadDatabase('json')"
                        >
                            Download JSON
                        </UButton>
                        <UButton
                            variant="outline"
                            class="min-h-11"
                            :loading="databaseExporting"
                            :disabled="databaseExporting"
                            @click="downloadDatabase('csv')"
                        >
                            Download CSV
                        </UButton>
                    </div>
                </UCard>
            </div>
        </section>
    </div>
</template>
