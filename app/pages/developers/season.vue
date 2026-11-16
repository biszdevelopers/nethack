<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";
import { SCORE_CURVE_PRESETS, type ScoreCurvePreset } from "~~/shared/score-curve";
import { LIVE_OVERRIDE_KEYS } from "~~/shared/schemas";
import { formatDateTime, fromDateTimeLocalString, toDateTimeLocalString } from "~/utils/datetime";
import AdminRubricManager from "~/components/admin/RubricManager.vue";
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Hackathon Administration | ${WEBSITE_NAME}`,
});

const toast = useToast();
const { data: user, status } = await useApiUser();
const { can } = useNethackPermissions();

if (status.value !== "pending" && status.value !== "idle") {
    if (!user.value || !can(NethackPermissions.all)) {
        throw createError({ statusCode: 403, statusMessage: "Access Denied" });
    }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const { data: adminData, refresh: refreshAdmin } = await useApiFetch("/api/admin/hackathon", {
    lazy: true,
    server: false,
    $fetch: globalThis.$fetch,
});
const hackathon = computed(() => adminData.value?.hackathon ?? null);
const seasons = computed(() => adminData.value?.seasons ?? []);

/**
 * A remote manifest cannot be written from the portal, so its live settings
 * stay read-only. Other seasons keep editable stored settings.
 */
const configReadOnly = computed(
    () =>
        adminData.value?.configSource === "remote" &&
        (selectedSeasonId.value === null || selectedSeasonIsActive.value),
);

// ---------------------------------------------------------------------------
// Helpers: ms epoch <-> datetime-local
// ---------------------------------------------------------------------------
function tsToDatetime(ts: unknown): string {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return "";
    return toDateTimeLocalString(num);
}
function datetimeToTs(s: string): number {
    return fromDateTimeLocalString(s);
}
function formatTimestamp(ts: unknown): string {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return "Not set";
    return formatDateTime(num);
}
/** Format a datetime-local form value so the overview matches the editable fields. */
function formatFormTimestamp(value: unknown): string {
    return formatTimestamp(datetimeToTs(String(value ?? "")));
}

async function downloadDatabase(format: "json" | "csv") {
    const blob = await apiFetch<Blob>(`/api/admin/database/export?format=${format}`, {
        responseType: "blob",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nethack-export.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

// All config fields — every field is per-season (saved with season_id)
const allFieldKeys = [
    "status",
    "voting_enabled",
    "judging_open",
    "results_published",
    "show_scores",
    "show_ranking",
    "max_votes_per_user",
    "theme_name",
    "theme_description",
    "announcement",
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
] as const;

const tsKeys: readonly string[] = [
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
];

const boolKeys = new Set([
    "voting_enabled",
    "judging_open",
    "results_published",
    "show_scores",
    "show_ranking",
]);

const toggleFields = [
    { key: "voting_enabled", label: "Voting Enabled" },
    { key: "judging_open", label: "Judging Open" },
    { key: "results_published", label: "Results Published" },
    { key: "show_scores", label: "Show Scores" },
    { key: "show_ranking", label: "Show Ranking" },
] as const;

const statusLabels: Record<string, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    voting: "Voting",
    finished: "Finished",
    paused: "Paused",
};

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
const hackathonForm = reactive<Record<string, any>>({});
const formInitialized = ref(false);
const saving = ref(false);
const scoreCurvePreset = ref<ScoreCurvePreset>("original");
const scoreCurveSaving = ref(false);
const scoreCurveItems = Object.entries(SCORE_CURVE_PRESETS).map(([value, preset]) => ({
    label: preset.label,
    value,
}));

/**
 * Fill the form from the selected season's own stored settings. The live row
 * is only a fallback when a field is absent, so two screens can never show
 * different values for the same season.
 */
function applyConfig(seasonId: number | null) {
    const h = hackathon.value;
    if (!h) return;

    const season =
        seasonId === null ? null : (seasons.value?.find((row: any) => row.id === seasonId) ?? null);
    const source = (season ?? h) as Record<string, unknown>;

    for (const key of allFieldKeys) {
        const value = source[key];
        if (tsKeys.includes(key)) {
            hackathonForm[key] = tsToDatetime(value);
        } else if (boolKeys.has(key) || key === "max_votes_per_user") {
            hackathonForm[key] = Number(value ?? 0);
        } else {
            hackathonForm[key] = value ?? "";
        }
    }

    formInitialized.value = true;
}

/** Normalize a form value to its wire format (bool→0/1, timestamp→number, number-string→number). */
function normalize(key: string, val: any): any {
    if (typeof val === "boolean") return val ? 1 : 0;
    if (tsKeys.includes(key)) return datetimeToTs(val as string);
    if (key === "max_votes_per_user") return Number(val);
    return val;
}

/** Compare a normalized value against the selected season, falling back to live settings. */
function hasChanged(key: string, normalized: any): boolean {
    const season = selectedSeason.value;
    const rawBaseline = season
        ? (season as unknown as Record<string, unknown>)[key]
        : (hackathon.value as any)?.[key];
    if (rawBaseline === undefined) return false;
    // A stored season's NULL means "empty", not "inherit the live value".
    const baseline =
        rawBaseline === null
            ? boolKeys.has(key) || key === "max_votes_per_user" || tsKeys.includes(key)
                ? 0
                : ""
            : rawBaseline;
    if (boolKeys.has(key) || key === "max_votes_per_user" || tsKeys.includes(key)) {
        return Number(normalized) !== Number(baseline);
    }
    return normalized !== baseline;
}

/**
 * Save one field at a time. Sending only the field the organizer touched means
 * a stale form can never overwrite unrelated settings.
 *
 * Saves are serialized: a second quick edit waits for the first refresh, then
 * re-reads the form so neither the server nor the visible form is left stale.
 */
let saveQueue: Promise<void> = Promise.resolve();

function saveField(key: string) {
    saveQueue = saveQueue.then(() => writeField(key)).catch(() => undefined);
    return saveQueue;
}

async function writeField(key: string) {
    if (configReadOnly.value && !(LIVE_OVERRIDE_KEYS as readonly string[]).includes(key)) {
        return;
    }
    const raw = hackathonForm[key];
    if (raw === undefined || raw === null) return;
    const value = normalize(key, raw);
    if (typeof value === "number" && Number.isNaN(value)) return;
    if (!hasChanged(key, value)) return;

    const body: Record<string, unknown> = { [key]: value };
    if (selectedSeasonId.value !== null) body.season_id = selectedSeasonId.value;

    saving.value = true;
    try {
        await apiFetch("/api/admin/hackathon", { method: "PATCH", body });
        await refreshAdmin();
    } catch (error) {
        toast.add({
            title: "Could not save season settings",
            description: getErrorMessage(error),
            color: "error",
        });
        applyConfig(selectedSeasonId.value);
    } finally {
        saving.value = false;
    }
}

// ---------------------------------------------------------------------------
// Selected season
// ---------------------------------------------------------------------------
const selectedSeasonId = ref<number | null>(null);
const activeTab = ref("overview");

const tabItems = [
    { label: "Overview", value: "overview", icon: "i-lucide-layout-dashboard" },
    { label: "Seasons", value: "seasons", icon: "i-lucide-calendar-range" },
    { label: "Event settings", value: "event", icon: "i-lucide-sliders-horizontal" },
    { label: "Scoring", value: "scoring", icon: "i-lucide-trophy" },
    { label: "Data", value: "data", icon: "i-lucide-database" },
];

// One-time initialization: wait for the live configuration, then select the
// active season so edits always target what visitors see. Stored seasons remain
// reachable through the season picker.
watchEffect(() => {
    const h = hackathon.value;
    if (!h || formInitialized.value) return;
    const active = seasons.value.find((season: Season) => season.is_active === 1);
    const fallback = seasons.value[seasons.value.length - 1];
    selectedSeasonId.value = active?.id ?? fallback?.id ?? null;
    applyConfig(selectedSeasonId.value);
});

const selectedSeason = computed(
    () => seasons.value.find((season: Season) => season.id === selectedSeasonId.value) ?? null,
);
const selectedSeasonIsActive = computed(() => selectedSeason.value?.is_active === 1);
const statusLabel = computed(
    () => statusLabels[hackathonForm.status] ?? statusLabels.not_started ?? "",
);

const seasonItems = computed(() => [
    { label: "None", value: null },
    ...(seasons.value?.map((s: { id: number; name: string }) => ({ label: s.name, value: s.id })) ||
        []),
]);

// ---------------------------------------------------------------------------
// Season name, score curve, activation, creation, deletion
// ---------------------------------------------------------------------------
const seasonNameForm = ref("");

watch(
    selectedSeasonId,
    (id) => {
        // Update season name
        seasonNameForm.value = seasons.value?.find((s: any) => s.id === id)?.name ?? "";
        scoreCurvePreset.value =
            (seasons.value?.find((s: any) => s.id === id)?.score_curve_preset as
                | ScoreCurvePreset
                | undefined) ?? "original";
        // Re-apply the full config (global + season overrides). When id is null,
        // applyConfig skips the overlay, showing only the global hackathon values.
        applyConfig(id);
    },
    { immediate: true },
);

async function saveScoreCurvePreset(value: ScoreCurvePreset) {
    const seasonId = selectedSeasonId.value;
    if (seasonId === null) return;
    scoreCurveSaving.value = true;
    try {
        await apiFetch(`/api/admin/seasons/${seasonId}/score-curve`, {
            method: "PATCH",
            body: { preset: value },
        });
        await refreshAdmin();
        toast.add({ title: "Score display curve updated.", color: "success" });
    } catch (error) {
        scoreCurvePreset.value =
            (seasons.value?.find((season: any) => season.id === seasonId)?.score_curve_preset as
                | ScoreCurvePreset
                | undefined) ?? "original";
        toast.add({
            title: "Could not update score curve",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        scoreCurveSaving.value = false;
    }
}

const seasonNameSaving = ref(false);

async function renameSeason() {
    if (selectedSeasonId.value === null || !seasonNameForm.value.trim()) return;
    seasonNameSaving.value = true;
    try {
        await apiFetch("/api/admin/seasons", {
            method: "PATCH",
            body: { id: selectedSeasonId.value, name: seasonNameForm.value.trim() },
        });
        await refreshAdmin();
        toast.add({ title: "Season renamed.", color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    } finally {
        seasonNameSaving.value = false;
    }
}

const boardApprovalSaving = ref(false);
const boardApprovalRecorded = computed(() =>
    Boolean(selectedSeason.value?.board_approved_at && selectedSeason.value?.board_approved_by),
);

async function updateBoardApproval(approved: boolean) {
    const season = selectedSeason.value;
    if (!season || season.is_blank_start !== 1) return;
    if (
        !confirm(
            approved
                ? `Confirm that the board approved ${season.name}? This will be recorded with your administrator account and the current time.`
                : `Revoke the recorded board approval for ${season.name}?`,
        )
    ) {
        return;
    }

    boardApprovalSaving.value = true;
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
        boardApprovalSaving.value = false;
    }
}

const activating = ref(false);

async function setActiveSeason() {
    const seasonId = selectedSeasonId.value;
    if (seasonId === null) return;
    if (
        !confirm(
            "Make this the active season? The public site, voting, and judging switch immediately.",
        )
    ) {
        return;
    }
    activating.value = true;
    try {
        await apiFetch("/api/seasons/active", {
            method: "PATCH",
            body: { season_id: seasonId },
        });
        await refreshAdmin();
        toast.add({ title: "Active season updated.", color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    } finally {
        activating.value = false;
    }
}

const creatingSeason = ref(false);

async function createSeason(copyLiveSettings = true) {
    const name = prompt("New season name:");
    if (!name || !name.trim()) return;
    creatingSeason.value = true;
    try {
        const result = await apiFetch<{ seasons: Season[] }>("/api/admin/seasons", {
            method: "POST",
            body: { name: name.trim(), copy_live_settings: copyLiveSettings },
        });
        await refreshAdmin();
        selectedSeasonId.value =
            result.seasons.find((season) => season.name === name.trim())?.id ?? null;
        toast.add({ title: `Season "${name.trim()}" created.`, color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    } finally {
        creatingSeason.value = false;
    }
}

const deletingSeason = ref(false);

async function deleteSeason() {
    const season = selectedSeason.value;
    if (!season || season.is_active === 1) return;
    if (!confirm(`Delete "${season.name}"? This cannot be undone.`)) return;
    deletingSeason.value = true;
    try {
        const result = await apiFetch<{ seasons: Season[] }>(`/api/admin/seasons/${season.id}`, {
            method: "DELETE",
        });
        await refreshAdmin();
        selectedSeasonId.value = result.seasons[result.seasons.length - 1]?.id ?? null;
        toast.add({ title: "Season deleted.", color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    } finally {
        deletingSeason.value = false;
    }
}
</script>

<template>
    <UDashboardPanel id="hackathon-admin">
        <template #header>
            <UDashboardNavbar title="Hackathon Administration">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="p-4 sm:p-6 space-y-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="space-y-1">
                        <h1 class="text-2xl font-semibold">Hackathon administration</h1>
                        <p class="text-sm text-ui-text-muted">
                            <template v-if="selectedSeason">
                                Managing
                                <span class="bold">{{ selectedSeason.name }}</span>
                                <UBadge
                                    v-if="selectedSeasonIsActive"
                                    color="success"
                                    variant="subtle"
                                    class="ms-2"
                                >
                                    Active
                                </UBadge>
                            </template>
                            <template v-else>No season selected.</template>
                        </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" class="min-h-8">
                        {{ statusLabel }}
                    </UBadge>
                </div>

                <UAlert
                    v-if="selectedSeason && !selectedSeasonIsActive"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="You are editing a stored season, not the live event"
                    :description="
                        adminData?.configSource === 'remote'
                            ? `Changes here save to ${selectedSeason.name}. Activating it applies its status and visibility switches immediately; schedule and theme stay under the remote manifest.`
                            : `Changes here save to ${selectedSeason.name} and do not affect the public site until you make it the active season.`
                    "
                >
                    <template #actions>
                        <UButton class="min-h-11" :loading="activating" @click="setActiveSeason">
                            Make {{ selectedSeason.name }} live
                        </UButton>
                    </template>
                </UAlert>

                <UAlert
                    v-else-if="selectedSeason"
                    color="success"
                    variant="subtle"
                    icon="i-lucide-radio"
                    title="These settings control the live site"
                    :description="
                        adminData?.configSource === 'remote'
                            ? `Status, voting, judging, and visibility switches for ${selectedSeason.name} save to PostgreSQL and apply immediately. Schedule and theme come from the remote manifest.`
                            : `Status, voting, judging, visibility switches, and the schedule below apply immediately to ${selectedSeason.name}.`
                    "
                />

                <UTabs
                    v-model="activeTab"
                    :items="tabItems"
                    :content="false"
                    :ui="{ list: 'w-full overflow-x-auto', trigger: 'whitespace-nowrap' }"
                    class="w-full"
                />

                <!-- Overview -->
                <section v-if="activeTab === 'overview'" class="space-y-4">
                    <div class="grid gap-4 md:grid-cols-2">
                        <UCard>
                            <template #header>
                                <h2 class="font-semibold">Theme</h2>
                            </template>
                            <p class="text-lg">{{ hackathonForm.theme_name || "No theme set" }}</p>
                            <p class="text-sm text-ui-text-muted mt-1">
                                {{ hackathonForm.theme_description || "No description yet." }}
                            </p>
                        </UCard>

                        <UCard>
                            <template #header>
                                <h2 class="font-semibold">Schedule</h2>
                            </template>
                            <dl class="space-y-1 text-sm">
                                <div class="flex justify-between gap-3">
                                    <dt class="text-ui-text-muted">Event</dt>
                                    <dd>
                                        {{ formatFormTimestamp(hackathonForm.start_timestamp) }} —
                                        {{ formatFormTimestamp(hackathonForm.end_timestamp) }}
                                    </dd>
                                </div>
                                <div class="flex justify-between gap-3">
                                    <dt class="text-ui-text-muted">Voting</dt>
                                    <dd>
                                        {{
                                            formatFormTimestamp(
                                                hackathonForm.voting_start_timestamp,
                                            )
                                        }}
                                        —
                                        {{
                                            formatFormTimestamp(hackathonForm.voting_end_timestamp)
                                        }}
                                    </dd>
                                </div>
                                <div class="flex justify-between gap-3">
                                    <dt class="text-ui-text-muted">Results open</dt>
                                    <dd>
                                        {{
                                            formatFormTimestamp(
                                                hackathonForm.results_open_timestamp,
                                            )
                                        }}
                                    </dd>
                                </div>
                            </dl>
                        </UCard>
                    </div>

                    <UCard>
                        <template #header>
                            <h2 class="font-semibold">What visitors can do</h2>
                        </template>
                        <ul class="grid gap-2 sm:grid-cols-2">
                            <li
                                v-for="toggle in toggleFields"
                                :key="toggle.key"
                                class="flex items-center justify-between gap-3"
                            >
                                <span>{{ toggle.label }}</span>
                                <UBadge
                                    :color="hackathonForm[toggle.key] ? 'success' : 'neutral'"
                                    variant="subtle"
                                >
                                    {{ hackathonForm[toggle.key] ? "On" : "Off" }}
                                </UBadge>
                            </li>
                        </ul>
                        <div class="flex flex-wrap gap-3 mt-4">
                            <UButton class="min-h-11" @click="activeTab = 'event'">
                                Edit event settings
                            </UButton>
                            <UButton class="min-h-11" variant="soft" @click="activeTab = 'scoring'">
                                Scoring and rubric
                            </UButton>
                        </div>
                    </UCard>
                </section>

                <!-- Seasons -->
                <section v-else-if="activeTab === 'seasons'" class="space-y-4">
                    <UCard>
                        <template #header>
                            <h2 class="font-semibold">Selected season</h2>
                        </template>
                        <div class="flex flex-wrap items-end gap-3">
                            <UFormField label="Season" class="w-full sm:w-auto sm:max-w-xs">
                                <USelect
                                    v-model="selectedSeasonId"
                                    :items="seasonItems"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UButton
                                class="min-h-11"
                                :loading="activating"
                                :disabled="selectedSeasonId === null || selectedSeasonIsActive"
                                @click="setActiveSeason"
                            >
                                {{ selectedSeasonIsActive ? "Active season" : "Set active" }}
                            </UButton>
                            <UButton
                                class="min-h-11"
                                variant="outline"
                                :loading="creatingSeason"
                                @click="createSeason(true)"
                            >
                                New season
                            </UButton>
                            <UButton
                                class="min-h-11"
                                variant="outline"
                                :loading="creatingSeason"
                                @click="createSeason(false)"
                            >
                                Blank season
                            </UButton>
                            <UButton
                                v-if="selectedSeason && !selectedSeasonIsActive"
                                class="min-h-11"
                                color="error"
                                variant="soft"
                                :loading="deletingSeason"
                                @click="deleteSeason"
                            >
                                Delete season
                            </UButton>
                        </div>
                        <p class="text-sm text-ui-text-muted mt-3">
                            New season copies the current live settings; Blank season starts with
                            event switches off and no theme, schedule, or rubric. A season must have
                            event dates, voting dates, a theme, a rubric, and recorded board
                            approval before activation. Activation switches the public site, voting,
                            and judging immediately.
                        </p>
                    </UCard>

                    <UCard v-if="selectedSeason?.is_blank_start === 1">
                        <template #header>
                            <h2 class="font-semibold">Board approval</h2>
                        </template>
                        <div class="flex flex-wrap items-center justify-between gap-4">
                            <div class="max-w-2xl text-sm text-ui-text-muted">
                                <p>
                                    Blank-season activation requires the board's approval in
                                    addition to its theme, dates, and rubric. Record this only after
                                    approval has been granted.
                                </p>
                                <p v-if="boardApprovalRecorded" class="mt-2">
                                    Approval recorded by administrator #{{
                                        selectedSeason.board_approved_by
                                    }}
                                    on
                                    {{ formatDateTime(selectedSeason.board_approved_at!) }}.
                                </p>
                                <p v-else class="mt-2">No board approval is recorded.</p>
                            </div>
                            <UButton
                                class="min-h-11"
                                :color="boardApprovalRecorded ? 'neutral' : 'primary'"
                                :variant="boardApprovalRecorded ? 'outline' : 'solid'"
                                :loading="boardApprovalSaving"
                                :disabled="selectedSeasonIsActive"
                                @click="updateBoardApproval(!boardApprovalRecorded)"
                            >
                                {{
                                    boardApprovalRecorded
                                        ? "Revoke board approval"
                                        : "Record board approval"
                                }}
                            </UButton>
                        </div>
                    </UCard>

                    <UCard v-if="selectedSeason">
                        <template #header>
                            <h2 class="font-semibold">Rename</h2>
                        </template>
                        <div class="flex flex-wrap items-end gap-3">
                            <UFormField label="Season name" class="min-w-0 flex-1">
                                <UInput
                                    v-model="seasonNameForm"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UButton
                                class="min-h-11"
                                :loading="seasonNameSaving"
                                @click="renameSeason"
                            >
                                Rename
                            </UButton>
                        </div>
                    </UCard>
                </section>

                <!-- Event settings -->
                <section v-else-if="activeTab === 'event'" class="space-y-4">
                    <section v-if="hackathon && formInitialized" class="bg-ui-bg p-6 space-y-4">
                        <h2 class="text-xl font-semibold">
                            Hackathon Configuration
                            <span v-if="saving" class="text-sm text-primary font-normal ms-2">
                                Saving...
                            </span>
                        </h2>
                        <p class="text-sm text-ui-text-muted">
                            <template
                                v-if="
                                    selectedSeasonIsActive && adminData?.configSource === 'remote'
                                "
                            >
                                Status and visibility changes save to PostgreSQL and apply
                                immediately. Schedule and theme come from the remote HACKATHON.yml.
                            </template>
                            <template v-else-if="selectedSeasonIsActive">
                                Status and visibility save to PostgreSQL; schedule and theme write
                                to HACKATHON.yml and the selected season.
                            </template>
                            <template v-else>
                                Changes save to the selected season as you go.
                            </template>
                        </p>

                        <fieldset class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <UFormField label="Status" name="status" class="w-full">
                                <USelect
                                    v-model="hackathonForm.status"
                                    :items="[
                                        { label: 'Not Started', value: 'not_started' },
                                        { label: 'In Progress', value: 'in_progress' },
                                        { label: 'Voting', value: 'voting' },
                                        { label: 'Finished', value: 'finished' },
                                        { label: 'Paused', value: 'paused' },
                                    ]"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @update:model-value="saveField('status')"
                                />
                            </UFormField>

                            <UFormField
                                label="Max Votes Per User"
                                name="max_votes_per_user"
                                class="w-full"
                            >
                                <UInput
                                    v-model="hackathonForm.max_votes_per_user"
                                    type="number"
                                    name="max_votes_per_user"
                                    min="0"
                                    max="100"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('max_votes_per_user')"
                                />
                            </UFormField>

                            <div
                                v-for="toggle in toggleFields"
                                :key="toggle.key"
                                class="flex items-center gap-3"
                            >
                                <UCheckbox
                                    v-model="hackathonForm[toggle.key]"
                                    :label="toggle.label"
                                    :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                                    :true-value="1"
                                    :false-value="0"
                                    @update:model-value="saveField(toggle.key)"
                                />
                            </div>

                            <UFormField label="Theme Name" name="theme_name" class="w-full">
                                <UInput
                                    v-model="hackathonForm.theme_name"
                                    name="theme_name"
                                    :disabled="configReadOnly"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('theme_name')"
                                />
                            </UFormField>

                            <UFormField
                                label="Theme Description"
                                name="theme_description"
                                class="w-full md:col-span-2"
                            >
                                <UTextarea
                                    v-model="hackathonForm.theme_description"
                                    name="theme_description"
                                    :rows="2"
                                    :disabled="configReadOnly"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('theme_description')"
                                />
                            </UFormField>

                            <UFormField
                                label="Visitor announcement"
                                name="announcement"
                                class="w-full md:col-span-2"
                                help="Shown above the schedule on the home page. Leave empty to hide it. This saves to PostgreSQL and works with a remote HACKATHON.yml."
                            >
                                <UTextarea
                                    v-model="hackathonForm.announcement"
                                    name="announcement"
                                    :rows="3"
                                    :maxlength="2000"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('announcement')"
                                />
                            </UFormField>
                        </fieldset>

                        <h3 class="text-lg font-semibold pt-2">Schedule</h3>
                        <p class="text-sm text-ui-text-muted">
                            Times are shown in this browser's local time zone.
                        </p>
                        <p v-if="configReadOnly" class="text-sm text-ui-text-muted">
                            Schedule is read-only from the remote manifest.
                        </p>
                        <fieldset
                            :disabled="configReadOnly"
                            class="grid grid-cols-1 md:grid-cols-2 gap-4"
                        >
                            <UFormField label="Start" name="start_timestamp" class="w-full">
                                <UInput
                                    v-model="hackathonForm.start_timestamp"
                                    type="datetime-local"
                                    name="start_timestamp"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('start_timestamp')"
                                />
                            </UFormField>

                            <UFormField label="End" name="end_timestamp" class="w-full">
                                <UInput
                                    v-model="hackathonForm.end_timestamp"
                                    type="datetime-local"
                                    name="end_timestamp"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('end_timestamp')"
                                />
                            </UFormField>

                            <UFormField
                                label="Voting Start"
                                name="voting_start_timestamp"
                                class="w-full"
                            >
                                <UInput
                                    v-model="hackathonForm.voting_start_timestamp"
                                    type="datetime-local"
                                    name="voting_start_timestamp"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('voting_start_timestamp')"
                                />
                            </UFormField>

                            <UFormField
                                label="Voting End"
                                name="voting_end_timestamp"
                                class="w-full"
                            >
                                <UInput
                                    v-model="hackathonForm.voting_end_timestamp"
                                    type="datetime-local"
                                    name="voting_end_timestamp"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('voting_end_timestamp')"
                                />
                            </UFormField>

                            <UFormField
                                label="Results Open"
                                name="results_open_timestamp"
                                class="w-full"
                            >
                                <UInput
                                    v-model="hackathonForm.results_open_timestamp"
                                    type="datetime-local"
                                    name="results_open_timestamp"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                    @change="saveField('results_open_timestamp')"
                                />
                            </UFormField>
                        </fieldset>
                    </section>
                </section>

                <!-- Scoring -->
                <section v-else-if="activeTab === 'scoring'" class="space-y-4">
                    <section v-if="selectedSeasonId !== null" class="bg-ui-bg p-6 space-y-3">
                        <h2 class="text-xl font-semibold">Score display curve</h2>
                        <p class="max-w-3xl text-sm text-ui-text-muted">
                            This changes the displayed score only. The original judge average stays
                            saved, and published ranking always uses that original score.
                        </p>
                        <div class="flex flex-wrap items-center gap-3">
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
                    </section>

                    <AdminRubricManager
                        v-if="selectedSeasonId !== null"
                        :key="selectedSeasonId"
                        :season-id="selectedSeasonId"
                        :seasons="seasons"
                    />
                    <p v-else class="text-sm text-ui-text-muted">
                        Select a season to manage its judging rubric.
                    </p>
                </section>

                <!-- Data -->
                <section v-else class="bg-ui-bg p-6 space-y-3">
                    <h2 class="text-xl font-semibold">Database Export</h2>
                    <p class="text-sm text-ui-text-muted">
                        Download a full snapshot of the database.
                    </p>
                    <div class="flex flex-wrap items-center gap-3">
                        <UButton
                            class="min-h-11"
                            color="primary"
                            variant="solid"
                            @click="downloadDatabase('json')"
                        >
                            Download JSON
                        </UButton>
                        <UButton
                            class="min-h-11"
                            color="neutral"
                            variant="outline"
                            @click="downloadDatabase('csv')"
                        >
                            Download CSV
                        </UButton>
                    </div>
                </section>
            </div>
        </template>
    </UDashboardPanel>
</template>
